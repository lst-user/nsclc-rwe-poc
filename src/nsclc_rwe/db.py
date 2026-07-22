import re

import psycopg

from .config import Settings

_READONLY_PATTERN = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)


class ReadOnlyQueryError(ValueError):
    pass


def run_readonly_query(
    settings: Settings, sql: str, max_rows: int = 200
) -> list[dict]:
    """Execute a read-only query against the OMOP CDM Postgres database.

    Rejects anything that isn't a SELECT/WITH statement and caps both the
    statement duration and the number of rows returned, since this is meant
    to be called from model-generated tool input.
    """
    if not _READONLY_PATTERN.match(sql):
        raise ReadOnlyQueryError("Only SELECT/WITH statements are allowed.")

    with psycopg.connect(settings.database_url, connect_timeout=10) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '15s'")
            cur.execute(sql)
            columns = [desc.name for desc in cur.description] if cur.description else []
            rows = cur.fetchmany(max_rows)

    return [dict(zip(columns, row)) for row in rows]
