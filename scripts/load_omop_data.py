"""One-off loader: populate the OMOP CDM Postgres database with OHDSI's
GiBleed sample dataset (v5.3), for local dev / demo purposes.

This is separate from nsclc_rwe.db.run_readonly_query on purpose: that
helper enforces SELECT/WITH-only because it's exposed to model-generated
tool input, whereas this script needs to run DDL and INSERT statements
against Neon's SQL-over-HTTP endpoint directly.

Usage:
    python scripts/load_omop_data.py

Requires DATABASE_URL in the environment (same as the rest of the app).
Downloads ~7MB from raw.githubusercontent.com (OHDSI's EunomiaDatasets and
CommonDataModel repos) and ~40MB after unzipping; needs both hosts
reachable.
"""

import csv
import glob
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
    "datasets/GiBleed/GiBleed_5.3.zip"
)
DDL_BASE = "https://raw.githubusercontent.com/OHDSI/CommonDataModel/main/inst/ddl/5.3/postgresql/"

# These tables' source CSVs contain duplicate surrogate-key values (a known
# quirk of this trimmed GiBleed export, not something the loader introduces
# -- verified by counting duplicate IDs in the raw CSVs before load). Adding
# a primary key on them would reject legitimate rows, so they're loaded
# without one.
TABLES_WITHOUT_PK = {"drug_exposure", "measurement", "observation"}


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


def run_batch(queries, label):
    _post_with_retry({"queries": queries}, label)


def split_statements(sql_text):
    stmts = []
    for raw in sql_text.split(";"):
        lines = [line for line in raw.splitlines() if not line.strip().startswith("--")]
        s = "\n".join(lines).strip()
        if s:
            stmts.append(s)
    return stmts


def fetch(url):
    resp = httpx.get(url, timeout=30.0)
    resp.raise_for_status()
    return resp


def create_schema():
    ddl = fetch(DDL_BASE + "OMOPCDM_postgresql_5.3_ddl.sql").text.replace("@cdmDatabaseSchema.", "")
    pks = fetch(DDL_BASE + "OMOPCDM_postgresql_5.3_primary_keys.sql").text.replace("@cdmDatabaseSchema.", "")

    tables = []
    for stmt in split_statements(ddl):
        if stmt.upper().startswith("CREATE TABLE"):
            tables.append(stmt.split()[2])

    drop_queries = [{"query": f"DROP TABLE IF EXISTS {t} CASCADE", "params": []} for t in reversed(tables)]
    create_queries = [{"query": stmt, "params": []} for stmt in split_statements(ddl)]
    pk_queries = [
        {"query": stmt, "params": []}
        for stmt in split_statements(pks)
        if not any(f"ALTER TABLE {t} " in stmt for t in TABLES_WITHOUT_PK)
    ]

    print(f"Dropping {len(drop_queries)} tables if they exist...")
    run_batch(drop_queries, "drop tables")
    print(f"Creating {len(create_queries)} tables...")
    run_batch(create_queries, "create tables")
    print(f"Adding {len(pk_queries)} primary keys...")
    run_batch(pk_queries, "add primary keys")
    print("Schema ready.")
    return tables


def load_csv(table_name, fileobj):
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
        query = f"INSERT INTO {table_name} ({col_list}) VALUES {', '.join(placeholders)}"
        _post_with_retry({"query": query, "params": params}, f"insert into {table_name} rows {i}-{i + len(batch)}")
        total += len(batch)
    return total


def main():
    tables = set(create_schema())

    print("Downloading GiBleed dataset...")
    zip_bytes = fetch(DATASET_URL).content
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    csv_names = sorted(n for n in zf.namelist() if n.lower().endswith(".csv") and "__MACOSX" not in n)

    start = time.time()
    for name in csv_names:
        table_name = os.path.splitext(os.path.basename(name))[0].lower()
        if table_name not in tables:
            print(f"skip {name}: no matching table")
            continue
        t0 = time.time()
        with zf.open(name) as f:
            n = load_csv(table_name, f)
        print(f"  {table_name}: loaded {n} rows in {time.time() - t0:.1f}s")

    print(f"Done in {time.time() - start:.1f}s")


if __name__ == "__main__":
    main()
