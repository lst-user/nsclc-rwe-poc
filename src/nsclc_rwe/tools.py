from anthropic import beta_tool

from .atlas import AtlasClient
from .config import load_settings
from .db import ReadOnlyQueryError, run_readonly_query

_settings = load_settings()
_atlas = AtlasClient(_settings)


@beta_tool
def query_omop_database(sql: str) -> str:
    """Run a read-only SQL query against the OMOP CDM Postgres database.

    Args:
        sql: A SELECT (or WITH ... SELECT) statement. INSERT/UPDATE/DELETE/DDL
            statements are rejected.
    """
    try:
        rows = run_readonly_query(_settings, sql)
    except ReadOnlyQueryError as e:
        return f"Error: {e}"
    except Exception as e:
        return f"Query failed: {e}"
    return str(rows)


@beta_tool
def search_atlas_vocabulary(query: str) -> str:
    """Search the OHDSI Atlas vocabulary for standard concepts matching a term.

    Args:
        query: Free-text term to search for, e.g. "non-small cell lung cancer".
    """
    try:
        results = _atlas.search_concepts(query)
    except Exception as e:
        return f"Atlas search failed: {e}"
    return str(results)
