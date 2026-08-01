"""One-off loader: additively merge a filtered slice of the real OHDSI
Standardized Vocabularies (from athena.ohdsi.org) into the CONCEPT table,
without touching patient data already loaded by load_omop_data.py.

Unlike GiBleed/Synthea27Nj (public, no-license-gate test datasets), the
full Athena download requires a personal account and license acceptance
(and a separate UMLS account for SNOMED/LOINC) -- it can't be fetched
automatically. Download it yourself from https://athena.ohdsi.org, then
pass the path to the zip it emails you:

    python scripts/load_athena_vocabulary.py /path/to/vocabulary_download_v5_*.zip

The full CONCEPT.csv in that download is ~6.4M rows (2.7M standard), and
CONCEPT_RELATIONSHIP/CONCEPT_ANCESTOR run into the billions/tens-of-millions
of rows -- loading all of it through Neon's SQL-over-HTTP endpoint (no bulk
COPY available in this sandbox) isn't practical. This script:

- Loads only CONCEPT rows that are both standard (STANDARD_CONCEPT='S') and
  in a clinically relevant domain (Condition, Drug, Procedure, Measurement,
  Observation, Device, Specimen, Visit, Race, Ethnicity, Gender) -- drops
  ~2.5M administrative/geography/etc. rows nothing here needs.
- Within Drug, additionally drops NDC-package/box-level concept classes
  (Marketed Product, *Box, Quant *, *Pack*) -- these are the bulk of
  RxNorm Extension's row count and aren't useful for cohort concept sets,
  which normally reference Ingredient/Clinical Drug/Branded Drug level.
- Loads DOMAIN/CONCEPT_CLASS/VOCABULARY/RELATIONSHIP in full (small).
- Skips CONCEPT_RELATIONSHIP/CONCEPT_ANCESTOR/CONCEPT_SYNONYM/DRUG_STRENGTH/
  CONCEPT_CPT4 entirely -- nothing in this repo uses them today, and
  CPT4 additionally requires a separate UMLS-keyed decode step Athena
  documents in the zip's readme.txt.

This brings the load down to ~1.2M CONCEPT rows (~20-25 minutes at this
sandbox's measured ~900 rows/sec over Neon's HTTP endpoint), from what
would otherwise be a multi-hour-plus job.

All inserts use ON CONFLICT DO NOTHING, same as merge_vocabulary.py: this
only adds concepts, never overwrites or removes anything patient records
already reference.
"""

import csv
import os
import sys
import time
import zipfile
from urllib.parse import urlsplit

import httpx

DATABASE_URL = os.environ["DATABASE_URL"]
HOST = urlsplit(DATABASE_URL).hostname
ENDPOINT = f"https://{HOST}/sql"
HEADERS = {
    "Neon-Connection-String": DATABASE_URL,
    "Content-Type": "application/json",
    "Accept": "application/json",
}
BATCH_SIZE = 500
csv.field_size_limit(sys.maxsize)

RELEVANT_DOMAINS = {
    "Condition", "Drug", "Procedure", "Measurement", "Observation",
    "Device", "Specimen", "Visit", "Race", "Ethnicity", "Gender",
}
DRUG_CLASS_EXCLUDE = {
    "Marketed Product", "Branded Drug Box", "Clinical Drug Box",
    "Quant Branded Drug", "Quant Branded Box", "Quant Clinical Drug",
    "Quant Clinical Box", "Branded Pack", "Clinical Pack",
    "Branded Pack Box", "Clinical Pack Box",
}

# table -> (zip member, primary key column, row filter or None)
MERGE_TABLES = {
    "domain": ("DOMAIN.csv", "domain_id", None),
    "concept_class": ("CONCEPT_CLASS.csv", "concept_class_id", None),
    "vocabulary": ("VOCABULARY.csv", "vocabulary_id", None),
    "relationship": ("RELATIONSHIP.csv", "relationship_id", None),
}


def _post_with_retry(body, label, attempts=5):
    delay = 2.0
    for attempt in range(1, attempts + 1):
        try:
            resp = httpx.post(ENDPOINT, headers=HEADERS, json=body, timeout=60.0)
        except httpx.TransportError as e:
            if attempt == attempts:
                raise RuntimeError(f"{label} failed after {attempts} attempts: {e}") from e
            print(f"  {label}: transient error ({e}), retrying in {delay:.0f}s (attempt {attempt}/{attempts})")
            time.sleep(delay)
            delay *= 2
            continue
        if resp.status_code != 200:
            try:
                detail = resp.json()
            except ValueError:
                detail = resp.text
            raise RuntimeError(f"{label} failed: {detail}")
        return resp
    raise RuntimeError(f"{label} failed after {attempts} attempts")


def _count(table: str) -> int:
    resp = _post_with_retry({"query": f"SELECT count(*) AS n FROM {table}", "params": []}, f"count {table}")
    return int(resp.json()["rows"][0]["n"])


def merge_rows(table_name: str, pk_column: str, columns: list[str], rows: list[list]) -> int:
    col_list = ", ".join(columns)
    n_cols = len(columns)
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        placeholders = []
        params = []
        pnum = 1
        for row in batch:
            placeholders.append("(" + ", ".join(f"${pnum + j}" for j in range(n_cols)) + ")")
            params.extend(row)
            pnum += n_cols
        query = (
            f"INSERT INTO {table_name} ({col_list}) VALUES {', '.join(placeholders)} "
            f"ON CONFLICT ({pk_column}) DO NOTHING"
        )
        _post_with_retry({"query": query, "params": params}, f"merge into {table_name} rows {i}-{i + len(batch)}")
        total += len(batch)
    return total


def merge_csv_member(zf: zipfile.ZipFile, member: str, table_name: str, pk_column: str) -> int:
    with zf.open(member) as raw:
        reader = csv.reader((line.decode("utf-8-sig") for line in raw), delimiter="\t")
        header = next(reader, None)
        if header is None:
            return 0
        columns = [h.strip().lower() for h in header]
        rows = [[v if v != "" else None for v in row] for row in reader if len(row) == len(columns)]
    if not rows:
        return 0
    return merge_rows(table_name, pk_column, columns, rows)


def merge_filtered_concepts(zf: zipfile.ZipFile) -> int:
    with zf.open("CONCEPT.csv") as raw:
        reader = csv.reader((line.decode("utf-8-sig") for line in raw), delimiter="\t")
        header = next(reader)
        columns = [h.strip().lower() for h in header]
        idx = {h: i for i, h in enumerate(columns)}

        total = 0
        batch: list[list] = []
        for row in reader:
            if len(row) != len(columns):
                continue
            if row[idx["standard_concept"]] != "S":
                continue
            domain = row[idx["domain_id"]]
            if domain not in RELEVANT_DOMAINS:
                continue
            if domain == "Drug" and row[idx["concept_class_id"]] in DRUG_CLASS_EXCLUDE:
                continue
            batch.append([v if v != "" else None for v in row])
            if len(batch) >= BATCH_SIZE:
                total += merge_rows("concept", "concept_id", columns, batch)
                if total % 50000 < BATCH_SIZE:
                    print(f"  concept: {total:,} rows merged so far...")
                batch = []
        if batch:
            total += merge_rows("concept", "concept_id", columns, batch)
    return total


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/load_athena_vocabulary.py /path/to/vocabulary_download_v5_*.zip")
    zip_path = sys.argv[1]

    before = _count("concept")
    print(f"concept table before merge: {before:,} rows")

    start = time.time()
    with zipfile.ZipFile(zip_path) as zf:
        for table_name, (member, pk, _filter) in MERGE_TABLES.items():
            t0 = time.time()
            n = merge_csv_member(zf, member, table_name, pk)
            print(f"  {table_name}: processed {n} candidate rows in {time.time() - t0:.1f}s")

        t0 = time.time()
        n = merge_filtered_concepts(zf)
        print(f"  concept: processed {n:,} candidate rows in {time.time() - t0:.1f}s")

    after = _count("concept")
    print(f"concept table after merge: {after:,} rows (+{after - before:,} new)")
    print(f"Done in {time.time() - start:.1f}s")


if __name__ == "__main__":
    main()
