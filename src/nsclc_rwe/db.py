import re
from urllib.parse import urlsplit

import httpx

from .config import Settings

_READONLY_PATTERN = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)


class ReadOnlyQueryError(ValueError):
    pass


def run_readonly_query(
    settings: Settings, sql: str, max_rows: int = 200
) -> list[dict]:
    """Execute a read-only query against the OMOP CDM Postgres database.

    Rejects anything that isn't a SELECT/WITH statement and caps the number
    of rows returned, since this is meant to be called from model-generated
    tool input.

    Runs over Neon's SQL-over-HTTP endpoint (``POST https://<host>/sql``)
    rather than the raw Postgres wire protocol: sandboxed environments that
    proxy HTTP(S) but not raw TCP can't reach port 5432 directly, and this
    path reuses the same HTTPS route that already works for other APIs.
    Only works against Neon-hosted databases, since the endpoint and its
    ``Neon-Connection-String`` header are a Neon-specific feature, not a
    standard Postgres one.
    """
    if not _READONLY_PATTERN.match(sql):
        raise ReadOnlyQueryError("Only SELECT/WITH statements are allowed.")

    host = urlsplit(settings.database_url.replace("postgresql://", "https://", 1)).hostname
    response = httpx.post(
        f"https://{host}/sql",
        json={"query": sql, "params": []},
        headers={
            "Neon-Connection-String": settings.database_url,
            "Neon-Raw-Text-Output": "true",
            "Neon-Array-Mode": "false",
        },
        timeout=15.0,
    )
    response.raise_for_status()
    rows = response.json()["rows"]
    return rows[:max_rows]
