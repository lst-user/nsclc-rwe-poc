from anthropic import beta_tool

from .atlas import AtlasClient
from .config import load_settings
from .db import ReadOnlyQueryError, run_readonly_query
from .db import search_concept as _search_concept

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


@beta_tool
def search_omop_concept(query: str, domain: str) -> str:
    """Search this database's own loaded OMOP vocabulary (the CONCEPT table) for
    standard concepts matching a term, filtered by domain.

    Unlike search_atlas_vocabulary (which queries Atlas's external demo
    vocabulary snapshot), this searches the vocabulary actually loaded into
    the Postgres database query_omop_database runs against -- use this when
    you need a concept_id that's guaranteed to exist in this database's own
    CONCEPT table, e.g. before building a cohort ConceptSet with
    define_cohort.

    Args:
        query: Free-text term to search for, e.g. "sinusitis".
        domain: OMOP domain to restrict results to, e.g. "Condition", "Drug",
            "Procedure", "Measurement", "Observation".
    """
    try:
        results = _search_concept(query, domain, _settings)
    except Exception as e:
        return f"Concept search failed: {e}"
    return str(results)
