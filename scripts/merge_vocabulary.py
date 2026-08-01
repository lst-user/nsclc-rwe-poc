"""One-off loader: additively merge a broader OMOP vocabulary into the
CONCEPT table, without touching the patient-level data already loaded by
load_omop_data.py.

Why this is separate from load_omop_data.py: GiBleed's own CONCEPT table is
deliberately trimmed to the ~444 concepts its GI-bleeding cohort needs, so
search_omop_concept returns nothing for unrelated terms (e.g. NSCLC). This
script merges in OHDSI's Synthea27Nj dataset's broader vocabulary (~2,300
concepts, covering a general synthetic population including oncology
terms) -- but only the CONCEPT and VOCABULARY rows, inserted with
ON CONFLICT DO NOTHING, so it only *adds* concepts and never overwrites or
removes anything GiBleed's already-loaded condition_occurrence/
drug_exposure/etc. rows reference by concept_id.

Usage:
    python scripts/merge_vocabulary.py

Requires DATABASE_URL in the environment, and that load_omop_data.py has
already been run (the concept/vocabulary tables must exist).
"""

import csv
import io
import os
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

DATASET_URL = (
    "https://raw.githubusercontent.com/OHDSI/EunomiaDatasets/main/"
    "datasets/Synthea27Nj/Synthea27Nj_5.4.zip"
)

# Table name -> primary key column, used for ON CONFLICT DO NOTHING.
# Only tables actually present with data in this particular Synthea27Nj
# export are merged; its DOMAIN/CONCEPT_CLASS/RELATIONSHIP/CONCEPT_SYNONYM
# exports are empty, so there's nothing to merge for those.
MERGE_TABLES = {
    "concept": "concept_id",
    "vocabulary": "vocabulary_id",
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


def merge_csv(table_name: str, pk_column: str, fileobj) -> int:
    reader = csv.reader(io.TextIOWrapper(fileobj, encoding="utf-8-sig", newline=""))
    header = next(reader, None)
    if header is None:
        print(f"  {table_name}: empty file, skipping")
        return 0
    columns = [h.strip().lower() for h in header]
    col_list = ", ".join(columns)
    n_cols = len(columns)

    rows = [[v if v != "" else None for v in row] for row in reader]
    if not rows:
        print(f"  {table_name}: no data rows, skipping")
        return 0

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


def main():
    print("Downloading Synthea27Nj vocabulary...")
    zip_bytes = httpx.get(DATASET_URL, timeout=30.0).content
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))

    before = _post_with_retry({"query": "SELECT count(*) AS n FROM concept", "params": []}, "count before")
    before_n = int(before.json()["rows"][0]["n"])
    print(f"concept table before merge: {before_n} rows")

    for name in zf.namelist():
        base = name.rsplit("/", 1)[-1].lower()
        table_name = base[: -len(".csv")] if base.endswith(".csv") else None
        if table_name not in MERGE_TABLES:
            continue
        pk = MERGE_TABLES[table_name]
        with zf.open(name) as f:
            n = merge_csv(table_name, pk, f)
        print(f"  {table_name}: processed {n} candidate rows")

    after = _post_with_retry({"query": "SELECT count(*) AS n FROM concept", "params": []}, "count after")
    after_n = int(after.json()["rows"][0]["n"])
    print(f"concept table after merge: {after_n} rows (+{after_n - before_n} new)")


if __name__ == "__main__":
    main()
