import re
from urllib.parse import urlsplit

import httpx

from .config import Settings, load_settings

_READONLY_PATTERN = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)


class ReadOnlyQueryError(ValueError):
    pass


class QueryExecutionError(RuntimeError):
    pass


def _sql_endpoint(database_url: str) -> str:
    host = urlsplit(database_url).hostname
    return f"https://{host}/sql"


def run_readonly_query(
    settings: Settings, sql: str, params: list | None = None, max_rows: int = 200
) -> list[dict]:
    """Execute a read-only query against the OMOP CDM Postgres database.

    Rejects anything that isn't a SELECT/WITH statement. Runs over Neon's
    SQL-over-HTTP endpoint (https://<host>/sql) instead of the raw Postgres
    wire protocol, since this sandbox's egress proxy only tunnels HTTP(S) —
    see README for why. The read-only restriction and statement timeout are
    still enforced by Postgres itself, via a batched request that runs
    `SET TRANSACTION READ ONLY` and `SET statement_timeout` in the same
    implicit transaction as the query.

    `params` are passed through to Postgres as query parameters ($1, $2, ...)
    rather than interpolated into `sql`, so callers should always use this
    for any value that isn't a literal written by the caller.
    """
    if not _READONLY_PATTERN.match(sql):
        raise ReadOnlyQueryError("Only SELECT/WITH statements are allowed.")

    response = httpx.post(
        _sql_endpoint(settings.database_url),
        headers={
            "Neon-Connection-String": settings.database_url,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json={
            "queries": [
                {"query": "SET TRANSACTION READ ONLY", "params": []},
                {"query": "SET statement_timeout = '15s'", "params": []},
                {"query": sql, "params": params or []},
            ]
        },
        timeout=20.0,
    )
    if response.status_code != 200:
        try:
            detail = response.json().get("message", response.text)
        except ValueError:
            detail = response.text
        raise QueryExecutionError(detail)

    rows = response.json()["results"][-1]["rows"]
    return rows[:max_rows]


def search_concept(
    query: str, domain: str, settings: Settings | None = None, limit: int = 20
) -> list[dict]:
    """Search the OMOP CONCEPT table for standard concepts matching a search term.

    Returns only standard (STANDARD_CONCEPT = 'S'), valid concepts in the
    given domain (e.g. 'Condition', 'Drug', 'Procedure', 'Measurement').
    Keys are UPPERCASE (CONCEPT_ID, CONCEPT_NAME, ...) to match both
    search_atlas_vocabulary's output and cohort.py's Concept model, so a
    result here can be dropped straight into a ConceptSetItem.

    Searches this database's own loaded vocabulary (e.g. GiBleed's trimmed
    subset after running scripts/load_omop_data.py), not Atlas's -- the two
    aren't the same vocabulary snapshot, so results can differ from
    search_atlas_vocabulary for the same term.
    """
    sql = """
        SELECT
            concept_id AS "CONCEPT_ID",
            concept_name AS "CONCEPT_NAME",
            domain_id AS "DOMAIN_ID",
            vocabulary_id AS "VOCABULARY_ID",
            concept_class_id AS "CONCEPT_CLASS_ID",
            concept_code AS "CONCEPT_CODE",
            standard_concept AS "STANDARD_CONCEPT"
        FROM concept
        WHERE domain_id = $1
          AND standard_concept = 'S'
          AND invalid_reason IS NULL
          AND concept_name ILIKE $2
        ORDER BY concept_name
        LIMIT $3
    """
    settings = settings or load_settings()
    return run_readonly_query(settings, sql, params=[domain, f"%{query}%", limit], max_rows=limit)
