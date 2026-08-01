import pytest

from nsclc_rwe.cohort import define_cohort


def _concept(concept_id: int, name: str, domain: str, vocab: str) -> dict:
    return {"CONCEPT_ID": concept_id, "CONCEPT_NAME": name, "DOMAIN_ID": domain, "VOCABULARY_ID": vocab}


CONDITION_SET = {"id": 0, "name": "NSCLC", "expression": {"items": [{"concept": _concept(4115276, "Non-small cell lung cancer", "Condition", "SNOMED")}]}}
DRUG_SET = {"id": 1, "name": "Osimertinib", "expression": {"items": [{"concept": _concept(35604931, "Osimertinib", "Drug", "RxNorm")}]}}
BRAIN_MET_SET = {"id": 2, "name": "Brain metastasis", "expression": {"items": [{"concept": _concept(4300544, "Secondary malignant neoplasm of brain", "Condition", "SNOMED")}]}}

VALID_COHORT = {
    "cohort": {
        "name": "Advanced NSCLC, EGFR TKI treated, no baseline brain mets",
        "ConceptSets": [CONDITION_SET, DRUG_SET, BRAIN_MET_SET],
        "PrimaryCriteria": {
            "CriteriaList": [{"criterion_type": "DrugExposure", "CodesetId": 1, "First": True}],
            "ObservationWindow": {"PriorDays": 365, "PostDays": 0},
        },
        "InclusionRules": [
            {
                "name": "Has NSCLC diagnosis before or on index",
                "expression": {
                    "Type": "ALL",
                    "CriteriaList": [
                        {
                            "Criteria": {"criterion_type": "ConditionOccurrence", "CodesetId": 0},
                            "StartWindow": {"Start": {"Coeff": "before"}, "End": {"Days": 0, "Coeff": "after"}},
                        }
                    ],
                },
            },
            {
                "name": "No brain metastasis before index",
                "expression": {
                    "Type": "AT_MOST",
                    "Count": 0,
                    "CriteriaList": [
                        {
                            "Criteria": {"criterion_type": "ConditionOccurrence", "CodesetId": 2},
                            "StartWindow": {"Start": {"Coeff": "before"}, "End": {"Days": 0, "Coeff": "before"}},
                        }
                    ],
                },
            },
        ],
        "EndStrategy": {"strategy_type": "custom_era", "CustomEra": {"DrugCodesetId": 1, "GapDays": 30}},
    }
}


def _cause_message(exc: ValueError) -> str:
    return str(exc.__cause__)


def test_tool_schema_covers_full_criterion_breadth():
    schema = define_cohort.to_dict()
    assert schema["name"] == "define_cohort"
    defs = schema["input_schema"]["$defs"]
    for criterion_type in [
        "ConditionOccurrenceCriterion",
        "DrugExposureCriterion",
        "ProcedureOccurrenceCriterion",
        "MeasurementCriterion",
        "ObservationCriterion",
        "DeathCriterion",
        "DeviceExposureCriterion",
        "SpecimenCriterion",
        "VisitOccurrenceCriterion",
        "VisitDetailCriterion",
        "ObservationPeriodCriterion",
        "ConditionEraCriterion",
        "DrugEraCriterion",
        "DoseEraCriterion",
        "PayerPlanPeriodCriterion",
        "LocationRegionCriterion",
    ]:
        assert criterion_type in defs


def test_valid_multi_rule_cohort_round_trips():
    result = define_cohort.call(VALID_COHORT)
    assert "Osimertinib" in result
    assert "custom_era" in result
    assert '"CONCEPT_ID": 4115276' in result


def test_rejects_criterion_referencing_unknown_concept_set():
    bad = {
        "cohort": {
            "name": "bad ref",
            "ConceptSets": [CONDITION_SET],
            "PrimaryCriteria": {"CriteriaList": [{"criterion_type": "ConditionOccurrence", "CodesetId": 99}]},
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "unknown concept_set" in _cause_message(exc_info.value)


def test_rejects_domain_mismatch_between_criterion_and_concept_set():
    bad = {
        "cohort": {
            "name": "domain mismatch",
            "ConceptSets": [CONDITION_SET],
            "PrimaryCriteria": {"CriteriaList": [{"criterion_type": "DrugExposure", "CodesetId": 0}]},
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "expected one of ['Drug']" in _cause_message(exc_info.value)


def test_rejects_at_least_group_without_count():
    bad = {
        "cohort": {
            "name": "bad group",
            "ConceptSets": [CONDITION_SET],
            "PrimaryCriteria": {"CriteriaList": [{"criterion_type": "ConditionOccurrence", "CodesetId": 0}]},
            "InclusionRules": [
                {
                    "name": "r",
                    "expression": {
                        "Type": "AT_LEAST",
                        "CriteriaList": [
                            {
                                "Criteria": {"criterion_type": "ConditionOccurrence", "CodesetId": 0},
                                "StartWindow": {"Start": {"Coeff": "before"}, "End": {"Coeff": "after"}},
                            }
                        ],
                    },
                }
            ],
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "Count is required" in _cause_message(exc_info.value)


def test_rejects_custom_era_end_strategy_with_unknown_concept_set():
    bad = {
        "cohort": {
            "name": "bad end strategy",
            "ConceptSets": [CONDITION_SET],
            "PrimaryCriteria": {"CriteriaList": [{"criterion_type": "ConditionOccurrence", "CodesetId": 0}]},
            "EndStrategy": {"strategy_type": "custom_era", "CustomEra": {"DrugCodesetId": 99}},
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "unknown concept_set" in _cause_message(exc_info.value)


def test_rejects_empty_criteria_group():
    bad = {
        "cohort": {
            "name": "empty group",
            "ConceptSets": [CONDITION_SET],
            "PrimaryCriteria": {"CriteriaList": [{"criterion_type": "ConditionOccurrence", "CodesetId": 0}]},
            "InclusionRules": [{"name": "r", "expression": {"Type": "ALL"}}],
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "needs at least one" in _cause_message(exc_info.value)


def test_additional_criteria_referencing_unknown_concept_set_is_rejected():
    bad = {
        "cohort": {
            "name": "bad additional criteria",
            "ConceptSets": [CONDITION_SET],
            "PrimaryCriteria": {"CriteriaList": [{"criterion_type": "ConditionOccurrence", "CodesetId": 0}]},
            "AdditionalCriteria": {
                "Type": "ALL",
                "CriteriaList": [
                    {
                        "Criteria": {"criterion_type": "ConditionOccurrence", "CodesetId": 99},
                        "StartWindow": {"Start": {"Coeff": "before"}, "End": {"Coeff": "after"}},
                    }
                ],
            },
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "unknown concept_set" in _cause_message(exc_info.value)
