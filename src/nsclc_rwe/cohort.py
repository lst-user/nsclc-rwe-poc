"""OMOP-style cohort definition, modeled loosely on OHDSI Atlas's CIRCE
cohort-expression JSON (ConceptSets + PrimaryCriteria + DemographicCriteria
+ ObservationWindow), scoped down to condition/drug concepts, age/sex/race
demographics, and an observation window. Atlas's own format additionally
covers inclusion-rule groups, censoring criteria, and other criterion types
(Visit, Measurement, Procedure, Death, ...); those aren't modeled here.
"""

from __future__ import annotations

from typing import Literal

from anthropic import beta_tool
from pydantic import BaseModel, Field, model_validator


class ConceptSetItem(BaseModel):
    """One concept plus hierarchy/mapping options, mirroring Atlas's ConceptSetItem."""

    concept_id: int = Field(
        description="OMOP standard concept_id, e.g. from search_atlas_vocabulary's CONCEPT_ID"
    )
    concept_name: str = Field(
        description="Human-readable concept name, for readability/audit -- not used for matching"
    )
    include_descendants: bool = Field(
        default=True, description="Include all descendant concepts in the vocabulary hierarchy"
    )
    include_mapped: bool = Field(
        default=False, description="Include non-standard source concepts that map to this concept"
    )
    is_excluded: bool = Field(
        default=False,
        description="Exclude this concept (and any included descendants/mapped concepts) from the set",
    )


class ConceptSet(BaseModel):
    """A named, reusable set of concepts, referenced by id from criteria below (Atlas's ConceptSets array)."""

    id: int = Field(
        description="Local id referenced from primary_criteria; must be unique within the cohort definition"
    )
    name: str
    domain: Literal["Condition", "Drug"] = Field(description="OMOP domain this concept set is drawn from")
    items: list[ConceptSetItem] = Field(min_length=1)


class Occurrence(BaseModel):
    """How many times a criterion must occur to qualify.

    Atlas's own Occurrence block uses numeric type codes (0/1/2); this uses
    descriptive string literals instead, since those are less error-prone
    for a model to produce correctly.
    """

    op: Literal["at_least", "at_most", "exactly"] = "at_least"
    count: int = Field(default=1, ge=0)


class ConditionOccurrenceCriterion(BaseModel):
    concept_set_id: int = Field(description="id of a ConceptSet with domain='Condition'")
    occurrence: Occurrence = Field(default_factory=Occurrence)


class DrugExposureCriterion(BaseModel):
    concept_set_id: int = Field(description="id of a ConceptSet with domain='Drug'")
    occurrence: Occurrence = Field(default_factory=Occurrence)


class ObservationWindow(BaseModel):
    """Continuous-observation requirement around the cohort index date (Atlas's ObservationWindow)."""

    prior_days: int = Field(
        default=0, ge=0, description="Days of continuous observation required before the index date"
    )
    post_days: int = Field(
        default=0, ge=0, description="Days of continuous observation required after the index date"
    )


class PrimaryCriteria(BaseModel):
    """Defines the cohort index event: which occurrence(s) qualify someone for entry,
    and under what observation requirement (Atlas's PrimaryCriteria)."""

    condition_occurrences: list[ConditionOccurrenceCriterion] = Field(default_factory=list)
    drug_exposures: list[DrugExposureCriterion] = Field(default_factory=list)
    combination: Literal["ALL", "ANY"] = Field(
        default="ANY", description="Whether ALL or ANY of the listed criteria must be met at the index date"
    )
    observation_window: ObservationWindow = Field(default_factory=ObservationWindow)

    @model_validator(mode="after")
    def _at_least_one_criterion(self) -> "PrimaryCriteria":
        if not self.condition_occurrences and not self.drug_exposures:
            raise ValueError(
                "primary_criteria needs at least one condition_occurrences or drug_exposures entry"
            )
        return self


class AgeCriterion(BaseModel):
    op: Literal["gte", "gt", "lte", "lt", "eq", "between"] = "gte"
    value: int = Field(ge=0, le=120, description="Age in years at the index date")
    value_upper: int | None = Field(
        default=None, ge=0, le=120, description="Upper bound in years; required when op='between'"
    )

    @model_validator(mode="after")
    def _between_needs_upper(self) -> "AgeCriterion":
        if self.op == "between" and self.value_upper is None:
            raise ValueError("value_upper is required when op='between'")
        return self


class DemographicCriteria(BaseModel):
    """Person-level filters evaluated at the index date (Atlas's DemographicCriteria, scoped to age/sex/race)."""

    age: AgeCriterion | None = None
    sex_concept_ids: list[int] | None = Field(
        default=None, description="OMOP gender_concept_id values, e.g. 8507=MALE, 8532=FEMALE"
    )
    race_concept_ids: list[int] | None = Field(
        default=None,
        description="OMOP race_concept_id values, e.g. 8527=White, 8516=Black or African American, 8515=Asian",
    )


class CohortDefinition(BaseModel):
    """An OMOP-style cohort definition, modeled loosely on OHDSI Atlas's cohort-expression JSON."""

    name: str = Field(description="Short, human-readable cohort name")
    description: str | None = Field(default=None, description="Free-text rationale for the cohort, for audit")
    concept_sets: list[ConceptSet] = Field(min_length=1)
    primary_criteria: PrimaryCriteria
    demographic_criteria: DemographicCriteria | None = None

    @model_validator(mode="after")
    def _criteria_reference_known_concept_sets(self) -> "CohortDefinition":
        ids = [cs.id for cs in self.concept_sets]
        if len(set(ids)) != len(ids):
            raise ValueError("concept_sets ids must be unique")
        known = set(ids)
        referenced = {c.concept_set_id for c in self.primary_criteria.condition_occurrences}
        referenced |= {d.concept_set_id for d in self.primary_criteria.drug_exposures}
        missing = referenced - known
        if missing:
            raise ValueError(f"primary_criteria references unknown concept_set id(s): {sorted(missing)}")
        return self


@beta_tool
def define_cohort(cohort: CohortDefinition) -> str:
    """Define an OMOP-style patient cohort from clinical concepts, demographics, and an observation window.

    Validates and normalizes a structured cohort definition: condition/drug
    concept sets (look up concept_ids with search_atlas_vocabulary first),
    age/sex/race demographic filters, and the continuous-observation window
    required around the index date. Returns the normalized definition as
    JSON. This only builds and validates the definition -- it doesn't yet
    execute it against the OMOP database.

    Args:
        cohort: The cohort definition to validate and normalize.
    """
    return cohort.model_dump_json(indent=2)
