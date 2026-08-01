import httpx

from nsclc_rwe.tools import search_omop_concept


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def test_search_omop_concept_schema():
    schema = search_omop_concept.to_dict()
    assert schema["name"] == "search_omop_concept"
    assert schema["input_schema"]["required"] == ["query", "domain"]


def test_search_omop_concept_returns_results(monkeypatch):
    def fake_post(url, headers, json, timeout):
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

    result = search_omop_concept.call({"query": "lung cancer", "domain": "Condition"})

    assert "Non-small cell lung cancer" in result
    assert "4115276" in result


def test_search_omop_concept_reports_failure_without_raising(monkeypatch):
    def fake_post(url, headers, json, timeout):
        return _FakeResponse(500, {"message": "connection refused"})

    monkeypatch.setattr(httpx, "post", fake_post)

    result = search_omop_concept.call({"query": "x", "domain": "Condition"})

    assert result.startswith("Concept search failed:")
