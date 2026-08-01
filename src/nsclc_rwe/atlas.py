import time

import httpx

from .config import Settings

# cohort.py deliberately deviates from Atlas's own CIRCE wire format in two
# ways (see its module docstring): an explicit criterion_type/strategy_type
# discriminator field instead of Atlas's "exactly one key present"
# polymorphism, and descriptive strings for Occurrence.Type/Window.Coeff
# instead of Atlas's numeric codes. Verified against atlas-demo.ohdsi.org
# live (fetched cohort definitions 99285/101431/158059): Atlas expects e.g.
# {"ConditionOccurrence": {"CodesetId": 0, ...}} rather than
# {"criterion_type": "ConditionOccurrence", "CodesetId": 0, ...}, and
# Occurrence.Type/Window.Coeff as 0/1/2 and -1/1 rather than
# "exactly"/"at_most"/"at_least" and "before"/"after".
_OCCURRENCE_TYPE_CODES = {"exactly": 0, "at_most": 1, "at_least": 2}
_WINDOW_COEFF_CODES = {"before": -1, "after": 1}

# Generation is an async Atlas job with no push notification -- get_cohort_count
# polls /cohortdefinition/{id}/info until the source's entry leaves these states.
_PENDING_GENERATION_STATUSES = {"STARTING", "PENDING", "RUNNING"}


def _to_atlas_expression(node):
    """Translate cohort.py's internal CIRCE representation into Atlas's actual
    wire format, recursively, so a define_cohort() result can be POSTed to a
    real Atlas WebAPI instance."""
    if isinstance(node, list):
        return [_to_atlas_expression(v) for v in node]
    if not isinstance(node, dict):
        return node

    out = {}
    for key, value in node.items():
        if key in ("criterion_type", "strategy_type"):
            continue
        if key == "Type" and value in _OCCURRENCE_TYPE_CODES:
            out[key] = _OCCURRENCE_TYPE_CODES[value]
        elif key == "Coeff" and value in _WINDOW_COEFF_CODES:
            out[key] = _WINDOW_COEFF_CODES[value]
        else:
            out[key] = _to_atlas_expression(value)

    if "criterion_type" in node:
        return {node["criterion_type"]: out}
    return out


class CohortGenerationError(RuntimeError):
    """Raised when Atlas reports a cohort generation job as failed."""


class AtlasClient:
    """Thin client for the OHDSI Atlas WebAPI.

    Endpoint shapes vary a bit by WebAPI version — verify against the live
    instance's Swagger UI (<ATLAS_BASE_URL>/../webapi/swagger-ui.html or the
    /info endpoint) if these paths don't match your deployment.
    """

    def __init__(self, settings: Settings, timeout: float = 15.0):
        self._source_key = settings.atlas_source_key
        self._client = httpx.Client(
            base_url=settings.atlas_base_url.rstrip("/"), timeout=timeout
        )
        self._source_ids: dict[str, int] = {}

    def info(self) -> dict:
        resp = self._client.get("/info")
        resp.raise_for_status()
        return resp.json()

    def search_concepts(self, query: str, limit: int = 20) -> list[dict]:
        resp = self._client.get(
            f"/vocabulary/{self._source_key}/search", params={"query": query}
        )
        resp.raise_for_status()
        results = resp.json()
        return results[:limit]

    def _resolve_source_id(self, source_key: str) -> int:
        if source_key not in self._source_ids:
            resp = self._client.get("/source/sources")
            resp.raise_for_status()
            self._source_ids = {s["sourceKey"]: s["sourceId"] for s in resp.json()}
        try:
            return self._source_ids[source_key]
        except KeyError:
            raise ValueError(f"Unknown Atlas source key: {source_key!r}") from None

    def create_cohort_definition(self, name: str, cohort_expression: dict) -> int:
        """Create a new cohort definition on Atlas from a define_cohort() result.

        `cohort_expression` is the parsed JSON define_cohort returns (its
        "cohort" body: name/ConceptSets/PrimaryCriteria/...); it's translated
        from cohort.py's internal representation into Atlas's actual wire
        format before sending. Returns the new cohort definition's id.
        """
        body = {
            "name": name,
            "expressionType": "SIMPLE_EXPRESSION",
            "expression": _to_atlas_expression(cohort_expression),
        }
        resp = self._client.post("/cohortdefinition", json=body)
        resp.raise_for_status()
        return resp.json()["id"]

    def generate_cohort(self, cohort_id: int, source_key: str | None = None) -> None:
        """Trigger cohort generation against a CDM data source. Async: returns
        once the job is queued, not once it completes -- see get_cohort_count."""
        resp = self._client.get(
            f"/cohortdefinition/{cohort_id}/generate/{source_key or self._source_key}"
        )
        resp.raise_for_status()

    def get_cohort_count(
        self,
        cohort_id: int,
        source_key: str | None = None,
        poll_interval: float = 3.0,
        timeout: float = 180.0,
    ) -> int:
        """Poll generation status until it completes, then return the person count."""
        source_key = source_key or self._source_key
        source_id = self._resolve_source_id(source_key)
        deadline = time.monotonic() + timeout

        while True:
            resp = self._client.get(f"/cohortdefinition/{cohort_id}/info")
            resp.raise_for_status()
            entry = next(
                (e for e in resp.json() if e.get("id", {}).get("sourceId") == source_id), None
            )
            if entry is not None and entry["status"] == "COMPLETE":
                return entry["personCount"]
            if entry is not None and entry["status"] not in _PENDING_GENERATION_STATUSES:
                raise CohortGenerationError(
                    f"Cohort {cohort_id} generation on {source_key} ended with status "
                    f"{entry['status']!r}: {entry.get('failMessage')}"
                )
            if time.monotonic() > deadline:
                raise TimeoutError(
                    f"Cohort {cohort_id} generation on {source_key} did not complete within {timeout}s"
                )
            time.sleep(poll_interval)

    def run_cohort(
        self, name: str, cohort_expression: dict, source_key: str | None = None
    ) -> int:
        """Create, generate, and return the person count for a cohort definition
        in one call -- the full path from a define_cohort() result to a real
        count against an Atlas CDM data source."""
        cohort_id = self.create_cohort_definition(name, cohort_expression)
        self.generate_cohort(cohort_id, source_key)
        return self.get_cohort_count(cohort_id, source_key)

    def close(self) -> None:
        self._client.close()
