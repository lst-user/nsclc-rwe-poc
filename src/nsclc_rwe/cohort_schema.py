"""OMOP-style cohort definition data model and Claude API tool.

`define_nsclc_cohort` below takes `CohortDefinition` as its sole argument; the
`@beta_tool` decorator generates its Claude API JSON `input_schema` directly
from this dataclass shape (nested objects, enums, and optional fields all
come through as standard JSON Schema, using `$defs`/`$ref` for the nested
dataclasses). It lives in its own module — rather than alongside the other
tools in `tools.py` — because it's a pure function with no OMOP database or
Atlas client dependency.
"""

from dataclasses import dataclass, field
from typing import Literal, Optional

from anthropic import beta_tool


@dataclass
class ConditionCriterion:
    """The qualifying condition (diagnosis) concept for cohort entry."""

    concept_id: int
    concept_name: Optional[str] = None
    include_descendants: bool = True


@dataclass
class DrugCriterion:
    """A qualifying drug exposure concept, e.g. a line-of-therapy anchor."""

    concept_id: int
    concept_name: Optional[str] = None
    include_descendants: bool = True


@dataclass
class Demographics:
    """Demographic constraints on cohort membership."""

    min_age: Optional[int] = None
    max_age: Optional[int] = None
    sex: Literal["male", "female", "any"] = "any"
    race_concept_ids: Optional[list[int]] = None


@dataclass
class ObservationWindow:
    """Continuous-observation and calendar-time constraints around the index event."""

    min_prior_observation_days: int = 0
    min_post_observation_days: int = 0
    study_start_date: Optional[str] = None
    study_end_date: Optional[str] = None


@dataclass
class CohortDefinition:
    """A complete OMOP-style cohort definition."""

    name: str
    condition: ConditionCriterion
    drug: Optional[DrugCriterion] = None
    demographics: Optional[Demographics] = None
    observation_window: ObservationWindow = field(default_factory=ObservationWindow)


@beta_tool
def define_nsclc_cohort(cohort: CohortDefinition) -> str:
    """Capture a structured OMOP-style cohort definition from an analyst's request.

    Call this once the qualifying condition (and, if relevant, drug) concepts
    have been resolved to standard OMOP concept_ids, e.g. via
    search_atlas_vocabulary. This does not query the database — it validates
    the structured definition and echoes it back for review.

    Args:
        cohort: The cohort definition — condition concept, optional drug
            concept, demographics, and observation window.
    """
    return _describe_cohort(cohort)


def _describe_cohort(cohort: CohortDefinition) -> str:
    lines = [f"Cohort: {cohort.name}"]

    condition = cohort.condition
    condition_label = f" ({condition.concept_name})" if condition.concept_name else ""
    lines.append(
        f"  Condition: concept_id={condition.concept_id}{condition_label}, "
        f"include_descendants={condition.include_descendants}"
    )

    if cohort.drug:
        drug = cohort.drug
        drug_label = f" ({drug.concept_name})" if drug.concept_name else ""
        lines.append(
            f"  Drug: concept_id={drug.concept_id}{drug_label}, "
            f"include_descendants={drug.include_descendants}"
        )

    if cohort.demographics:
        d = cohort.demographics
        lines.append(
            f"  Demographics: age=[{d.min_age or '-'}, {d.max_age or '-'}], "
            f"sex={d.sex}, race_concept_ids={d.race_concept_ids or 'any'}"
        )

    w = cohort.observation_window
    lines.append(
        f"  Observation window: min_prior_observation_days={w.min_prior_observation_days}, "
        f"min_post_observation_days={w.min_post_observation_days}, "
        f"study_start_date={w.study_start_date or '-'}, "
        f"study_end_date={w.study_end_date or '-'}"
    )

    return "\n".join(lines)
