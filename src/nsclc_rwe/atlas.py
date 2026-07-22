import httpx

from .config import Settings


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

    def close(self) -> None:
        self._client.close()
