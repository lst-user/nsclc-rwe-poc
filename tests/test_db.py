import httpx
import pytest

from nsclc_rwe.config import Settings
from nsclc_rwe.db import ReadOnlyQueryError, run_readonly_query, search_concept

SETTINGS = Settings(
    database_url="postgresql://u:p@ep-test.neon.tech/db",
    atlas_base_url="https://atlas-demo.ohdsi.org/WebAPI",
    atlas_source_key="SYNPUF1K",
)


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def test_run_readonly_query_rejects_non_select(monkeypatch):
    with pytest.raises(ReadOnlyQueryError):
        run_readonly_query(SETTINGS, "DELETE FROM person")


def test_search_concept_sends_parameterized_query_not_string_interpolation(monkeypatch):
    captured = {}

    def fake_post(url, headers, json, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        last_query = json["queries"][-1]
        return _FakeResponse(
            200,
            {
                "results": [
                    {"rows": []},
                    {"rows": []},
                    {
                        "rows": [
                            {
                                "CONCEPT_ID": 4115276,
                                "CONCEPT_NAME": "Non-small cell lung cancer",
                                "DOMAIN_ID": "Condition",
                                "VOCABULARY_ID": "SNOMED",
                                "CONCEPT_CLASS_ID": "Disorder",
                                "CONCEPT_CODE": "254637007",
                                "STANDARD_CONCEPT": "S",
                            }
                        ]
                    },
                ]
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)

    results = search_concept("lung cancer", "Condition", settings=SETTINGS)

    assert results == [
        {
            "CONCEPT_ID": 4115276,
            "CONCEPT_NAME": "Non-small cell lung cancer",
            "DOMAIN_ID": "Condition",
            "VOCABULARY_ID": "SNOMED",
            "CONCEPT_CLASS_ID": "Disorder",
            "CONCEPT_CODE": "254637007",
            "STANDARD_CONCEPT": "S",
        }
    ]

    last_query = captured["json"]["queries"][-1]
    assert "$1" in last_query["query"] and "$2" in last_query["query"]
    assert "lung cancer" not in last_query["query"]
    assert last_query["params"] == ["Condition", "%lung cancer%", 20]
    assert captured["headers"]["Neon-Connection-String"] == SETTINGS.database_url


def test_search_concept_respects_custom_limit(monkeypatch):
    def fake_post(url, headers, json, timeout):
        last_query = json["queries"][-1]
        assert last_query["params"][-1] == 5
        return _FakeResponse(200, {"results": [{"rows": []}, {"rows": []}, {"rows": []}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    search_concept("x", "Drug", settings=SETTINGS, limit=5)


def test_search_concept_defaults_to_load_settings_when_none_given(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", SETTINGS.database_url)

    def fake_post(url, headers, json, timeout):
        assert headers["Neon-Connection-String"] == SETTINGS.database_url
        return _FakeResponse(200, {"results": [{"rows": []}, {"rows": []}, {"rows": []}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    search_concept("x", "Drug")
