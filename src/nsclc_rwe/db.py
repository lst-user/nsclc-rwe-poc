import re
from urllib.parse import urlsplit

import httpx

from .config import Settings

_READONLY_PATTERN = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)


class ReadOnlyQueryError(ValueError):
    pass


class QueryExecutionError(RuntimeError):
    pass


def _sql_endpoint(database_url: str) -> str:
    host = urlsplit(database_url).hostname
    return f"https://{host}/sql"


def run_readonly_query(
    settings: Settings, sql: str, max_rows: int = 200
) -> list[dict]:
    """Execute a read-only query against the OMOP CDM Postgres database.

    Rejects anything that isn't a SELECT/WITH statement. Runs over Neon's
    SQL-over-HTTP endpoint (https://<host>/sql) instead of the raw Postgres
    wire protocol, since this sandbox's egress proxy only tunnels HTTP(S) —
    see README for why. The read-only restriction and statement timeout are
    still enforced by Postgres itself, via a batched request that runs
    `SET TRANSACTION READ ONLY` and `SET statement_timeout` in the same
    implicit transaction as the query.
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
                {"query": sql, "params": []},
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
