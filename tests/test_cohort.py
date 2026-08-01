import pytest

from nsclc_rwe.cohort import define_cohort

CONDITION_SET = {
    "id": 0,
    "name": "NSCLC",
    "items": [
        {
            "concept": {
                "concept_id": 4115276,
                "concept_name": "Non-small cell lung cancer",
                "domain_id": "Condition",
                "vocabulary_id": "SNOMED",
                "standard_concept": "S",
            }
        }
    ],
}
DRUG_SET = {
    "id": 1,
    "name": "Osimertinib",
    "items": [
        {
            "concept": {
                "concept_id": 35604931,
                "concept_name": "Osimertinib",
                "domain_id": "Drug",
                "vocabulary_id": "RxNorm",
                "standard_concept": "S",
            }
        }
    ],
}
BRAIN_MET_SET = {
    "id": 2,
    "name": "Brain metastasis",
    "items": [
        {
            "concept": {
                "concept_id": 4300544,
                "concept_name": "Secondary malignant neoplasm of brain",
                "domain_id": "Condition",
                "vocabulary_id": "SNOMED",
                "standard_concept": "S",
            }
        }
    ],
}

VALID_COHORT = {
    "cohort": {
        "name": "Advanced NSCLC, EGFR TKI treated, no baseline brain mets",
        "concept_sets": [CONDITION_SET, DRUG_SET, BRAIN_MET_SET],
        "primary_criteria": {
            "criteria_list": [{"criterion_type": "DrugExposure", "concept_set_id": 1, "first": True}],
            "observation_window": {"prior_days": 365, "post_days": 0},
        },
        "inclusion_rules": [
            {
                "name": "Has NSCLC diagnosis before or on index",
                "expression": {
                    "type": "ALL",
                    "criteria_list": [
                        {
                            "criterion": {"criterion_type": "ConditionOccurrence", "concept_set_id": 0},
                            "start_window": {
                                "start": {"direction": "before"},
                                "end": {"days": 0, "direction": "after"},
                            },
                        }
                    ],
                },
            },
            {
                "name": "No brain metastasis before index",
                "expression": {
                    "type": "AT_MOST",
                    "count": 0,
                    "criteria_list": [
                        {
                            "criterion": {"criterion_type": "ConditionOccurrence", "concept_set_id": 2},
                            "start_window": {
                                "start": {"direction": "before"},
                                "end": {"days": 0, "direction": "before"},
                            },
                        }
                    ],
                },
            },
        ],
        "end_strategy": {"strategy_type": "custom_era", "drug_concept_set_id": 1, "gap_days": 30},
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


def test_rejects_criterion_referencing_unknown_concept_set():
    bad = {
        "cohort": {
            "name": "bad ref",
            "concept_sets": [CONDITION_SET],
            "primary_criteria": {"criteria_list": [{"criterion_type": "ConditionOccurrence", "concept_set_id": 99}]},
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "unknown concept_set" in _cause_message(exc_info.value)


def test_rejects_domain_mismatch_between_criterion_and_concept_set():
    bad = {
        "cohort": {
            "name": "domain mismatch",
            "concept_sets": [CONDITION_SET],
            "primary_criteria": {"criteria_list": [{"criterion_type": "DrugExposure", "concept_set_id": 0}]},
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "expected one of ['Drug']" in _cause_message(exc_info.value)


def test_rejects_at_least_group_without_count():
    bad = {
        "cohort": {
            "name": "bad group",
            "concept_sets": [CONDITION_SET],
            "primary_criteria": {"criteria_list": [{"criterion_type": "ConditionOccurrence", "concept_set_id": 0}]},
            "inclusion_rules": [
                {
                    "name": "r",
                    "expression": {
                        "type": "AT_LEAST",
                        "criteria_list": [
                            {
                                "criterion": {"criterion_type": "ConditionOccurrence", "concept_set_id": 0},
                                "start_window": {"start": {"direction": "before"}, "end": {"direction": "after"}},
                            }
                        ],
                    },
                }
            ],
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "count is required" in _cause_message(exc_info.value)


def test_rejects_custom_era_end_strategy_with_unknown_concept_set():
    bad = {
        "cohort": {
            "name": "bad end strategy",
            "concept_sets": [CONDITION_SET],
            "primary_criteria": {"criteria_list": [{"criterion_type": "ConditionOccurrence", "concept_set_id": 0}]},
            "end_strategy": {"strategy_type": "custom_era", "drug_concept_set_id": 99},
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "unknown concept_set" in _cause_message(exc_info.value)


def test_rejects_empty_criteria_group():
    bad = {
        "cohort": {
            "name": "empty group",
            "concept_sets": [CONDITION_SET],
            "primary_criteria": {"criteria_list": [{"criterion_type": "ConditionOccurrence", "concept_set_id": 0}]},
            "inclusion_rules": [{"name": "r", "expression": {"type": "ALL"}}],
        }
    }
    with pytest.raises(ValueError) as exc_info:
        define_cohort.call(bad)
    assert "needs at least one" in _cause_message(exc_info.value)
