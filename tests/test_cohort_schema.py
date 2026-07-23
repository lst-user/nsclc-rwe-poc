from nsclc_rwe.cohort_schema import (
    CohortDefinition,
    ConditionCriterion,
    Demographics,
    DrugCriterion,
    ObservationWindow,
    define_nsclc_cohort,
)


def _sample_cohort() -> CohortDefinition:
    return CohortDefinition(
        name="Metastatic NSCLC on pembrolizumab",
        condition=ConditionCriterion(
            concept_id=254637,
            concept_name="Non-small cell lung cancer",
        ),
        drug=DrugCriterion(concept_id=40165244, concept_name="pembrolizumab"),
        demographics=Demographics(min_age=18, max_age=90, sex="any"),
        observation_window=ObservationWindow(
            min_prior_observation_days=365,
            study_start_date="2018-01-01",
            study_end_date="2024-12-31",
        ),
    )


def test_define_nsclc_cohort_echoes_structured_definition():
    output = define_nsclc_cohort(cohort=_sample_cohort())

    assert "Metastatic NSCLC on pembrolizumab" in output
    assert "concept_id=254637" in output
    assert "Non-small cell lung cancer" in output
    assert "concept_id=40165244" in output
    assert "sex=any" in output
    assert "min_prior_observation_days=365" in output
    assert "study_start_date=2018-01-01" in output


def test_define_nsclc_cohort_handles_optional_drug_and_demographics():
    cohort = CohortDefinition(
        name="All NSCLC diagnoses",
        condition=ConditionCriterion(concept_id=254637),
    )

    output = define_nsclc_cohort(cohort=cohort)

    assert "Drug:" not in output
    assert "Demographics:" not in output
    assert "min_prior_observation_days=0" in output


def test_input_schema_is_a_claude_tool_definition():
    schema = define_nsclc_cohort.input_schema

    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"cohort"}

    cohort_schema = schema["$defs"]["CohortDefinition"]
    assert set(cohort_schema["required"]) == {"name", "condition"}

    demographics_schema = schema["$defs"]["Demographics"]
    assert demographics_schema["properties"]["sex"]["enum"] == [
        "male",
        "female",
        "any",
    ]


def test_tool_name_and_description_are_set():
    assert define_nsclc_cohort.name == "define_nsclc_cohort"
    assert "cohort definition" in define_nsclc_cohort.description.lower()
