import pytest

from nsclc_rwe.atlas import AtlasClient, CohortGenerationError, _to_atlas_expression
from nsclc_rwe.config import Settings

SETTINGS = Settings(
    database_url="postgresql://u:p@ep-test.neon.tech/db",
    atlas_base_url="https://atlas-demo.ohdsi.org/WebAPI",
    atlas_source_key="SYNPUF1K",
)


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}: {self.text}")


def _client() -> AtlasClient:
    return AtlasClient(SETTINGS)


def test_to_atlas_expression_wraps_criterion_type_as_single_key():
    node = {"criterion_type": "ConditionOccurrence", "CodesetId": 0, "ConditionTypeExclude": False}
    assert _to_atlas_expression(node) == {
        "ConditionOccurrence": {"CodesetId": 0, "ConditionTypeExclude": False}
    }


def test_to_atlas_expression_drops_strategy_type_without_rewrapping():
    node = {"strategy_type": "date_offset", "DateOffset": {"DateField": "StartDate", "Offset": 30}}
    assert _to_atlas_expression(node) == {"DateOffset": {"DateField": "StartDate", "Offset": 30}}


def test_to_atlas_expression_converts_occurrence_type_and_window_coeff():
    node = {
        "Occurrence": {"Type": "at_least", "Count": 1, "IsDistinct": False},
        "StartWindow": {"Start": {"Days": None, "Coeff": "before"}, "End": {"Days": 0, "Coeff": "after"}},
    }
    assert _to_atlas_expression(node) == {
        "Occurrence": {"Type": 2, "Count": 1, "IsDistinct": False},
        "StartWindow": {"Start": {"Days": None, "Coeff": -1}, "End": {"Days": 0, "Coeff": 1}},
    }


def test_to_atlas_expression_leaves_unrelated_type_values_alone():
    node = {"Type": "ALL", "PrimaryCriteriaLimit": {"Type": "First"}}
    assert _to_atlas_expression(node) == {"Type": "ALL", "PrimaryCriteriaLimit": {"Type": "First"}}


def test_create_cohort_definition_posts_translated_expression_and_returns_id(monkeypatch):
    captured = {}

    def fake_post(url, json):
        captured["url"] = url
        captured["json"] = json
        return _FakeResponse(200, {"id": 12345})

    client = _client()
    monkeypatch.setattr(client._client, "post", fake_post)

    cohort_id = client.create_cohort_definition(
        "NSCLC",
        {"name": "NSCLC", "ConceptSets": [], "PrimaryCriteria": {
            "CriteriaList": [{"criterion_type": "ConditionOccurrence", "CodesetId": 0}]
        }},
    )

    assert cohort_id == 12345
    assert captured["url"] == "/cohortdefinition"
    assert captured["json"]["expressionType"] == "SIMPLE_EXPRESSION"
    assert captured["json"]["expression"]["PrimaryCriteria"]["CriteriaList"] == [
        {"ConditionOccurrence": {"CodesetId": 0}}
    ]


def test_generate_cohort_hits_generate_endpoint_for_source_key(monkeypatch):
    captured = {}

    def fake_get(url):
        captured["url"] = url
        return _FakeResponse(200, {"status": "STARTING"})

    client = _client()
    monkeypatch.setattr(client._client, "get", fake_get)

    client.generate_cohort(42, source_key="SYNPUF5PCT")

    assert captured["url"] == "/cohortdefinition/42/generate/SYNPUF5PCT"


def test_get_cohort_count_polls_until_complete(monkeypatch):
    calls = {"n": 0}

    def fake_get(url):
        if url == "/source/sources":
            return _FakeResponse(200, [{"sourceKey": "SYNPUF1K", "sourceId": 6}])
        calls["n"] += 1
        status = "RUNNING" if calls["n"] < 3 else "COMPLETE"
        return _FakeResponse(
            200,
            [{"id": {"cohortDefinitionId": 42, "sourceId": 6}, "status": status, "personCount": 228}],
        )

    client = _client()
    monkeypatch.setattr(client._client, "get", fake_get)

    count = client.get_cohort_count(42, poll_interval=0)

    assert count == 228
    assert calls["n"] == 3


def test_get_cohort_count_raises_on_failed_generation(monkeypatch):
    def fake_get(url):
        if url == "/source/sources":
            return _FakeResponse(200, [{"sourceKey": "SYNPUF1K", "sourceId": 6}])
        return _FakeResponse(
            200,
            [{
                "id": {"cohortDefinitionId": 42, "sourceId": 6},
                "status": "FAILED",
                "personCount": None,
                "failMessage": "boom",
            }],
        )

    client = _client()
    monkeypatch.setattr(client._client, "get", fake_get)

    with pytest.raises(CohortGenerationError, match="boom"):
        client.get_cohort_count(42, poll_interval=0)


def test_get_cohort_count_times_out_if_never_complete(monkeypatch):
    def fake_get(url):
        if url == "/source/sources":
            return _FakeResponse(200, [{"sourceKey": "SYNPUF1K", "sourceId": 6}])
        return _FakeResponse(
            200,
            [{"id": {"cohortDefinitionId": 42, "sourceId": 6}, "status": "RUNNING", "personCount": None}],
        )

    client = _client()
    monkeypatch.setattr(client._client, "get", fake_get)

    with pytest.raises(TimeoutError):
        client.get_cohort_count(42, poll_interval=0, timeout=0)


def test_get_cohort_count_raises_on_unknown_source_key(monkeypatch):
    def fake_get(url):
        assert url == "/source/sources"
        return _FakeResponse(200, [{"sourceKey": "SYNPUF1K", "sourceId": 6}])

    client = _client()
    monkeypatch.setattr(client._client, "get", fake_get)

    with pytest.raises(ValueError, match="NOPE"):
        client.get_cohort_count(42, source_key="NOPE")


def test_run_cohort_creates_generates_and_returns_count(monkeypatch):
    calls = []

    def fake_post(url, json):
        calls.append(("post", url))
        return _FakeResponse(200, {"id": 42})

    def fake_get(url):
        calls.append(("get", url))
        if url == "/cohortdefinition/42/generate/SYNPUF1K":
            return _FakeResponse(200, {"status": "STARTING"})
        if url == "/source/sources":
            return _FakeResponse(200, [{"sourceKey": "SYNPUF1K", "sourceId": 6}])
        return _FakeResponse(
            200,
            [{"id": {"cohortDefinitionId": 42, "sourceId": 6}, "status": "COMPLETE", "personCount": 228}],
        )

    client = _client()
    monkeypatch.setattr(client._client, "post", fake_post)
    monkeypatch.setattr(client._client, "get", fake_get)

    count = client.run_cohort("NSCLC", {"name": "NSCLC", "PrimaryCriteria": {"CriteriaList": []}})

    assert count == 228
    assert ("post", "/cohortdefinition") in calls
    assert ("get", "/cohortdefinition/42/generate/SYNPUF1K") in calls
