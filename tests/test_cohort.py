import pytest

from nsclc_rwe.cohort import define_cohort

VALID_COHORT = {
    "cohort": {
        "name": "Advanced NSCLC on osimertinib, 18-89",
        "concept_sets": [
            {
                "id": 0,
                "name": "Non-small cell lung cancer",
                "domain": "Condition",
                "items": [{"concept_id": 4115276, "concept_name": "Non-small cell lung cancer"}],
            },
            {
                "id": 1,
                "name": "Osimertinib",
                "domain": "Drug",
                "items": [{"concept_id": 35604931, "concept_name": "Osimertinib"}],
            },
        ],
        "primary_criteria": {
            "condition_occurrences": [{"concept_set_id": 0}],
            "drug_exposures": [{"concept_set_id": 1}],
            "combination": "ALL",
        },
        "demographic_criteria": {"age": {"op": "between", "value": 18, "value_upper": 89}},
    }
}


def test_tool_schema_has_expected_shape():
    schema = define_cohort.to_dict()
    assert schema["name"] == "define_cohort"
    assert schema["input_schema"]["required"] == ["cohort"]
    assert "CohortDefinition" in schema["input_schema"]["$defs"]


def test_valid_cohort_round_trips():
    result = define_cohort.call(VALID_COHORT)
    assert "Non-small cell lung cancer" in result
    assert '"combination": "ALL"' in result


def test_rejects_criterion_referencing_unknown_concept_set():
    bad = {
        "cohort": {
            "name": "bad ref",
            "concept_sets": [
                {"id": 0, "name": "x", "domain": "Condition", "items": [{"concept_id": 1, "concept_name": "x"}]}
            ],
            "primary_criteria": {"condition_occurrences": [{"concept_set_id": 99}]},
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "unknown concept_set" in str(exc_info.value.__cause__)


def test_rejects_between_age_without_upper_bound():
    bad = {
        "cohort": {
            "name": "bad age",
            "concept_sets": [
                {"id": 0, "name": "x", "domain": "Condition", "items": [{"concept_id": 1, "concept_name": "x"}]}
            ],
            "primary_criteria": {"condition_occurrences": [{"concept_set_id": 0}]},
            "demographic_criteria": {"age": {"op": "between", "value": 18}},
        }
    }
    with pytest.raises(ValueError):
        define_cohort.call(bad)


def test_rejects_primary_criteria_with_no_criterion():
    bad = {
        "cohort": {
            "name": "empty",
            "concept_sets": [
                {"id": 0, "name": "x", "domain": "Condition", "items": [{"concept_id": 1, "concept_name": "x"}]}
            ],
            "primary_criteria": {},
        }
    }
    with pytest.raises(ValueError):
        define_cohort.call(bad)
