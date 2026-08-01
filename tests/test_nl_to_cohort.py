from types import SimpleNamespace

from nsclc_rwe.nl_to_cohort import extract_cohort_result

VALID_COHORT_INPUT = {
    "cohort": {
        "name": "NSCLC",
        "ConceptSets": [
            {
                "id": 0,
                "name": "NSCLC",
                "expression": {
                    "items": [
                        {
                            "concept": {
                                "CONCEPT_ID": 4115276,
                                "CONCEPT_NAME": "Non-small cell lung cancer",
                                "DOMAIN_ID": "Condition",
                                "VOCABULARY_ID": "SNOMED",
                            }
                        }
                    ]
                },
            }
        ],
        "PrimaryCriteria": {"CriteriaList": [{"criterion_type": "ConditionOccurrence", "CodesetId": 0}]},
    }
}


def _tool_use(name: str, input: dict) -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", name=name, input=input)


def test_ignores_non_tool_use_blocks():
    text_block = SimpleNamespace(type="text", text="thinking...")
    assert extract_cohort_result(text_block) is None


def test_ignores_tool_use_for_other_tools():
    block = _tool_use("search_omop_concept", {"query": "lung", "domain": "Condition"})
    assert extract_cohort_result(block) is None


def test_extracts_json_from_successful_define_cohort_call():
    block = _tool_use("define_cohort", VALID_COHORT_INPUT)
    result = extract_cohort_result(block)
    assert result is not None
    assert "Non-small cell lung cancer" in result


def test_returns_none_for_invalid_define_cohort_call():
    bad_input = {
        "cohort": {
            "name": "bad",
            "ConceptSets": VALID_COHORT_INPUT["cohort"]["ConceptSets"],
            "PrimaryCriteria": {"CriteriaList": [{"criterion_type": "ConditionOccurrence", "CodesetId": 99}]},
        }
    }
    block = _tool_use("define_cohort", bad_input)
    assert extract_cohort_result(block) is None
