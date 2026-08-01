"""OMOP-style cohort definition, modeled on OHDSI Atlas's CIRCE cohort-
expression JSON (see https://github.com/OHDSI/circe-be) at close to its
full breadth: concept sets, ~16 clinical-event criterion types, recursive
inclusion-rule groups with correlated criteria and time windows, censoring
criteria, an end strategy, and collapse settings.

Two deliberate deviations from Atlas's own wire format, both because they'd
otherwise be more error-prone for a model to produce correctly:

- Criteria are tagged with an explicit `criterion_type` discriminator field
  instead of Atlas's "exactly one key present" polymorphism (e.g.
  `{"ConditionOccurrence": {...}}`). The discriminator values are the same
  strings Atlas itself uses for those keys.
- Enum-like fields (Occurrence.op, NumericRange.op, Window coefficients)
  use descriptive string literals instead of Atlas's numeric type codes.

Real Atlas ConceptSets have no fixed domain -- a set's domain is whatever
its member concepts' domain_id values say. CohortExpression's validator
checks that concept sets referenced by a given criterion type actually
contain concepts of the expected domain, for the domains where that's
well-defined (Condition, Drug, Procedure, Measurement, Observation,
Device, Specimen, Visit).
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from anthropic import beta_tool
from pydantic import BaseModel, Field, model_validator

# --------------------------------------------------------------------------
# Primitives
# --------------------------------------------------------------------------


class Concept(BaseModel):
    """An OMOP standard concept, matching search_atlas_vocabulary's output shape
    (concept_id <-> CONCEPT_ID, concept_name <-> CONCEPT_NAME, etc.)."""

    concept_id: int
    concept_name: str
    domain_id: str = Field(description="OMOP domain, e.g. 'Condition', 'Drug', 'Procedure'")
    vocabulary_id: str = Field(description="Source vocabulary, e.g. 'SNOMED', 'RxNorm'")
    standard_concept: Literal["S", "C", None] = Field(
        default=None, description="'S' standard, 'C' classification, null if non-standard"
    )


class NumericRange(BaseModel):
    """A numeric comparison, used for Age, Quantity, Value, etc. (Atlas's NumericRange)."""

    op: Literal["lt", "lte", "eq", "neq", "gt", "gte", "bt", "nbt"] = Field(
        description="bt/nbt (between/not between) require value_upper"
    )
    value: float
    value_upper: float | None = Field(default=None, description="Required when op is 'bt' or 'nbt'")

    @model_validator(mode="after")
    def _between_needs_upper(self) -> "NumericRange":
        if self.op in ("bt", "nbt") and self.value_upper is None:
            raise ValueError("value_upper is required when op is 'bt' or 'nbt'")
        return self


class DateRange(BaseModel):
    """A date comparison, used for OccurrenceStartDate/EndDate etc. (Atlas's DateRange)."""

    op: Literal["lt", "lte", "eq", "neq", "gt", "gte", "bt", "nbt"]
    value: str = Field(description="ISO 8601 date, e.g. '2020-01-01'")
    value_upper: str | None = Field(default=None, description="Required when op is 'bt' or 'nbt'")

    @model_validator(mode="after")
    def _between_needs_upper(self) -> "DateRange":
        if self.op in ("bt", "nbt") and self.value_upper is None:
            raise ValueError("value_upper is required when op is 'bt' or 'nbt'")
        return self


class TextFilter(BaseModel):
    op: Literal["contains", "starts_with", "ends_with", "exact"] = "exact"
    text: str


class WindowEndpoint(BaseModel):
    days: int | None = Field(default=None, ge=0, description="null means unbounded in this direction")
    direction: Literal["before", "after"] = "before"


class Window(BaseModel):
    """A time window relative to the index date, used to correlate criteria (Atlas's Window)."""

    start: WindowEndpoint
    end: WindowEndpoint
    use_index_end: bool = Field(default=False, description="Anchor the window end to the index event's end date")
    use_event_end: bool = Field(
        default=False, description="Anchor the window end to this criterion's own event end date"
    )


class Occurrence(BaseModel):
    """How many times a criterion must occur to qualify (Atlas's Occurrence, with
    descriptive op values instead of Atlas's numeric type codes)."""

    op: Literal["at_least", "at_most", "exactly"] = "at_least"
    count: int = Field(default=1, ge=0)
    is_distinct: bool = Field(default=False, description="Count distinct occurrences only")


# --------------------------------------------------------------------------
# Concept sets
# --------------------------------------------------------------------------


class ConceptSetItem(BaseModel):
    concept: Concept
    include_descendants: bool = Field(default=True)
    include_mapped: bool = Field(default=False)
    is_excluded: bool = Field(default=False)


class ConceptSet(BaseModel):
    id: int = Field(description="Local id referenced by criteria elsewhere in the cohort expression")
    name: str
    items: list[ConceptSetItem] = Field(min_length=1)


# --------------------------------------------------------------------------
# Demographic criteria (used inside CriteriaGroup.demographic_criteria_list)
# --------------------------------------------------------------------------


class DemographicCriteria(BaseModel):
    age: NumericRange | None = None
    gender_concept_ids: list[int] | None = Field(
        default=None, description="OMOP gender_concept_id values, e.g. 8507=MALE, 8532=FEMALE"
    )
    race_concept_ids: list[int] | None = Field(default=None, description="OMOP race_concept_id values")
    ethnicity_concept_ids: list[int] | None = Field(default=None, description="OMOP ethnicity_concept_id values")
    occurrence_start_date: DateRange | None = None
    occurrence_end_date: DateRange | None = None


# --------------------------------------------------------------------------
# Clinical event criteria -- Atlas's ~16 domain-specific criterion types
# --------------------------------------------------------------------------


class _ClinicalEventBase(BaseModel):
    """Fields shared by most event-based criteria (Atlas's common Criteria fields)."""

    concept_set_id: int = Field(description="id of a ConceptSet in concept_sets")
    first: bool = Field(default=False, description="Only the first qualifying occurrence counts")
    occurrence_start_date: DateRange | None = None
    occurrence_end_date: DateRange | None = None
    age: NumericRange | None = Field(default=None, description="Age of the person at the event")
    gender_concept_ids: list[int] | None = None
    provider_specialty_concept_ids: list[int] | None = None
    visit_type_concept_ids: list[int] | None = None
    correlated_criteria: "CriteriaGroup | None" = Field(
        default=None, description="Additional criteria correlated to this event, within their own time windows"
    )


class ConditionOccurrenceCriterion(_ClinicalEventBase):
    criterion_type: Literal["ConditionOccurrence"] = "ConditionOccurrence"
    condition_type_concept_ids: list[int] | None = None
    condition_source_concept_id: int | None = None


class ConditionEraCriterion(BaseModel):
    criterion_type: Literal["ConditionEra"] = "ConditionEra"
    concept_set_id: int
    first: bool = False
    era_start_date: DateRange | None = None
    era_end_date: DateRange | None = None
    occurrence_count: NumericRange | None = None
    era_length: NumericRange | None = None
    gap_days: NumericRange | None = None
    age_at_start: NumericRange | None = None
    age_at_end: NumericRange | None = None
    correlated_criteria: "CriteriaGroup | None" = None


class DrugExposureCriterion(_ClinicalEventBase):
    criterion_type: Literal["DrugExposure"] = "DrugExposure"
    drug_type_concept_ids: list[int] | None = None
    refills: NumericRange | None = None
    quantity: NumericRange | None = None
    days_supply: NumericRange | None = None
    route_concept_ids: list[int] | None = None
    dose_unit_concept_ids: list[int] | None = None
    effective_drug_dose: NumericRange | None = None
    stop_reason: TextFilter | None = None
    lot_number: TextFilter | None = None
    drug_source_concept_id: int | None = None


class DrugEraCriterion(BaseModel):
    criterion_type: Literal["DrugEra"] = "DrugEra"
    concept_set_id: int
    first: bool = False
    era_start_date: DateRange | None = None
    era_end_date: DateRange | None = None
    occurrence_count: NumericRange | None = None
    era_length: NumericRange | None = None
    gap_days: NumericRange | None = None
    age_at_start: NumericRange | None = None
    age_at_end: NumericRange | None = None
    correlated_criteria: "CriteriaGroup | None" = None


class DoseEraCriterion(BaseModel):
    criterion_type: Literal["DoseEra"] = "DoseEra"
    concept_set_id: int
    dose_value: NumericRange | None = None
    unit_concept_ids: list[int] | None = None
    era_start_date: DateRange | None = None
    era_end_date: DateRange | None = None
    era_length: NumericRange | None = None
    age_at_start: NumericRange | None = None
    age_at_end: NumericRange | None = None
    correlated_criteria: "CriteriaGroup | None" = None


class ProcedureOccurrenceCriterion(_ClinicalEventBase):
    criterion_type: Literal["ProcedureOccurrence"] = "ProcedureOccurrence"
    procedure_type_concept_ids: list[int] | None = None
    modifier_concept_ids: list[int] | None = None
    quantity: NumericRange | None = None
    procedure_source_concept_id: int | None = None


class MeasurementCriterion(_ClinicalEventBase):
    criterion_type: Literal["Measurement"] = "Measurement"
    measurement_type_concept_ids: list[int] | None = None
    operator_concept_ids: list[int] | None = None
    value_as_number: NumericRange | None = None
    value_as_concept_ids: list[int] | None = None
    unit_concept_ids: list[int] | None = None
    range_low: NumericRange | None = None
    range_high: NumericRange | None = None
    abnormal: bool | None = None
    measurement_source_concept_id: int | None = None


class ObservationCriterion(_ClinicalEventBase):
    criterion_type: Literal["Observation"] = "Observation"
    observation_type_concept_ids: list[int] | None = None
    value_as_number: NumericRange | None = None
    value_as_concept_ids: list[int] | None = None
    value_as_string: TextFilter | None = None
    qualifier_concept_ids: list[int] | None = None
    unit_concept_ids: list[int] | None = None
    observation_source_concept_id: int | None = None


class DeathCriterion(BaseModel):
    criterion_type: Literal["Death"] = "Death"
    concept_set_id: int | None = Field(default=None, description="Optional: restrict to specific cause-of-death concepts")
    occurrence_start_date: DateRange | None = None
    death_type_concept_ids: list[int] | None = None
    death_source_concept_id: int | None = None
    correlated_criteria: "CriteriaGroup | None" = None


class DeviceExposureCriterion(_ClinicalEventBase):
    criterion_type: Literal["DeviceExposure"] = "DeviceExposure"
    device_type_concept_ids: list[int] | None = None
    unique_device_id: TextFilter | None = None
    quantity: NumericRange | None = None
    device_source_concept_id: int | None = None


class SpecimenCriterion(_ClinicalEventBase):
    criterion_type: Literal["Specimen"] = "Specimen"
    specimen_type_concept_ids: list[int] | None = None
    quantity: NumericRange | None = None
    unit_concept_ids: list[int] | None = None
    anatomic_site_concept_ids: list[int] | None = None
    disease_status_concept_ids: list[int] | None = None
    source_id: TextFilter | None = None


class VisitOccurrenceCriterion(BaseModel):
    criterion_type: Literal["VisitOccurrence"] = "VisitOccurrence"
    concept_set_id: int = Field(description="id of a ConceptSet identifying the visit type(s)")
    first: bool = False
    occurrence_start_date: DateRange | None = None
    occurrence_end_date: DateRange | None = None
    age: NumericRange | None = None
    gender_concept_ids: list[int] | None = None
    visit_length: NumericRange | None = Field(default=None, description="Visit length in days")
    correlated_criteria: "CriteriaGroup | None" = None


class VisitDetailCriterion(VisitOccurrenceCriterion):
    criterion_type: Literal["VisitDetail"] = "VisitDetail"  # type: ignore[assignment]
    visit_detail_type_concept_ids: list[int] | None = None


class ObservationPeriodCriterion(BaseModel):
    criterion_type: Literal["ObservationPeriod"] = "ObservationPeriod"
    period_type_concept_ids: list[int] | None = None
    period_start_date: DateRange | None = None
    period_end_date: DateRange | None = None
    user_defined_period: bool = False
    period_length: NumericRange | None = None
    age_at_start: NumericRange | None = None
    age_at_end: NumericRange | None = None


class PayerPlanPeriodCriterion(BaseModel):
    criterion_type: Literal["PayerPlanPeriod"] = "PayerPlanPeriod"
    payer_concept_ids: list[int] | None = None
    plan_concept_ids: list[int] | None = None
    sponsor_concept_ids: list[int] | None = None
    period_start_date: DateRange | None = None
    period_end_date: DateRange | None = None
    period_length: NumericRange | None = None
    correlated_criteria: "CriteriaGroup | None" = None


class LocationRegionCriterion(BaseModel):
    criterion_type: Literal["LocationRegion"] = "LocationRegion"
    concept_set_id: int = Field(description="id of a ConceptSet identifying the region(s)")
    start_date: DateRange | None = None
    end_date: DateRange | None = None


Criterion = Annotated[
    Union[
        ConditionOccurrenceCriterion,
        ConditionEraCriterion,
        DrugExposureCriterion,
        DrugEraCriterion,
        DoseEraCriterion,
        ProcedureOccurrenceCriterion,
        MeasurementCriterion,
        ObservationCriterion,
        DeathCriterion,
        DeviceExposureCriterion,
        SpecimenCriterion,
        VisitDetailCriterion,
        VisitOccurrenceCriterion,
        ObservationPeriodCriterion,
        PayerPlanPeriodCriterion,
        LocationRegionCriterion,
    ],
    Field(discriminator="criterion_type"),
]

# Domains where a criterion type's expected concept-set domain is well-defined
# enough to validate against the concept sets' actual member concepts.
_EXPECTED_DOMAIN_BY_CRITERION_TYPE: dict[str, set[str]] = {
    "ConditionOccurrence": {"Condition"},
    "ConditionEra": {"Condition"},
    "DrugExposure": {"Drug"},
    "DrugEra": {"Drug"},
    "DoseEra": {"Drug"},
    "ProcedureOccurrence": {"Procedure"},
    "Measurement": {"Measurement"},
    "Observation": {"Observation"},
    "DeviceExposure": {"Device"},
    "Specimen": {"Specimen"},
    "VisitOccurrence": {"Visit"},
    "VisitDetail": {"Visit"},
}


# --------------------------------------------------------------------------
# Correlated criteria and recursive criteria groups (inclusion rule bodies)
# --------------------------------------------------------------------------


class CorrelatedCriteria(BaseModel):
    """A criterion plus the time window (relative to the index date) it must fall within."""

    criterion: Criterion
    start_window: Window
    end_window: Window | None = None
    restrict_visit: bool = Field(default=False, description="Require the same visit as the index event")
    ignore_observation_period: bool = False
    occurrence: Occurrence = Field(default_factory=Occurrence)


class CriteriaGroup(BaseModel):
    """A boolean combination of criteria, demographics, and nested groups (Atlas's CriteriaGroup),
    used for inclusion rules and for a criterion's own correlated_criteria."""

    type: Literal["ALL", "ANY", "AT_LEAST", "AT_MOST"] = "ALL"
    count: int | None = Field(default=None, ge=0, description="Required when type is AT_LEAST or AT_MOST")
    criteria_list: list[CorrelatedCriteria] = Field(default_factory=list)
    demographic_criteria_list: list[DemographicCriteria] = Field(default_factory=list)
    groups: list["CriteriaGroup"] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate(self) -> "CriteriaGroup":
        if self.type in ("AT_LEAST", "AT_MOST") and self.count is None:
            raise ValueError("count is required when type is AT_LEAST or AT_MOST")
        if not self.criteria_list and not self.demographic_criteria_list and not self.groups:
            raise ValueError("a CriteriaGroup needs at least one criterion, demographic filter, or nested group")
        return self


CriteriaGroup.model_rebuild()


class InclusionRule(BaseModel):
    name: str
    description: str | None = None
    expression: CriteriaGroup


# --------------------------------------------------------------------------
# Primary criteria (defines the cohort index event)
# --------------------------------------------------------------------------


class ObservationWindow(BaseModel):
    prior_days: int = Field(default=0, ge=0, description="Days of continuous observation required before the index date")
    post_days: int = Field(default=0, ge=0, description="Days of continuous observation required after the index date")


class PrimaryCriteria(BaseModel):
    criteria_list: list[Criterion] = Field(min_length=1, description="Events that can qualify someone for cohort entry")
    observation_window: ObservationWindow = Field(default_factory=ObservationWindow)
    primary_criteria_limit: Literal["First", "All"] = Field(
        default="First", description="Which qualifying event(s) become the index date"
    )


# --------------------------------------------------------------------------
# End strategy, censoring, collapse settings
# --------------------------------------------------------------------------


class DateOffsetEndStrategy(BaseModel):
    strategy_type: Literal["date_offset"] = "date_offset"
    date_field: Literal["start_date", "end_date"] = "start_date"
    offset_days: int = 0


class CustomEraEndStrategy(BaseModel):
    strategy_type: Literal["custom_era"] = "custom_era"
    drug_concept_set_id: int = Field(description="id of a Drug ConceptSet defining era continuation")
    gap_days: int = Field(default=0, ge=0, description="Allowed gap (days) between drug eras before the cohort ends")
    offset_days: int = 0


EndStrategy = Annotated[Union[DateOffsetEndStrategy, CustomEraEndStrategy], Field(discriminator="strategy_type")]


class CollapseSettings(BaseModel):
    collapse_type: Literal["era", "none"] = "era"
    era_pad_days: int = Field(default=0, ge=0, description="Gap (days) allowed between spans before they're merged")


class CensorWindow(BaseModel):
    start_date: str | None = Field(default=None, description="ISO 8601 date")
    end_date: str | None = Field(default=None, description="ISO 8601 date")


# --------------------------------------------------------------------------
# Top-level cohort expression
# --------------------------------------------------------------------------


class CohortExpression(BaseModel):
    """An OMOP-style cohort definition, modeled on OHDSI Atlas's CohortExpression JSON."""

    name: str = Field(description="Short, human-readable cohort name")
    description: str | None = None
    concept_sets: list[ConceptSet] = Field(min_length=1)
    primary_criteria: PrimaryCriteria
    qualified_limit: Literal["First", "All"] = Field(
        default="First", description="Across all qualifying index events, which one(s) form the cohort"
    )
    expression_limit: Literal["First", "All"] = Field(
        default="First", description="Which cohort era(s) per person are kept in the final cohort"
    )
    inclusion_rules: list[InclusionRule] = Field(default_factory=list)
    end_strategy: EndStrategy | None = Field(default=None, description="How cohort exit is determined; defaults to end of the index event/era")
    censoring_criteria: list[Criterion] = Field(
        default_factory=list, description="Events that end cohort membership early if observed"
    )
    collapse_settings: CollapseSettings = Field(default_factory=CollapseSettings)
    censor_window: CensorWindow | None = None
    cdm_version_range: str = Field(default=">=5.3.0", description="Informational OMOP CDM version compatibility range")

    @model_validator(mode="after")
    def _validate_concept_set_references(self) -> "CohortExpression":
        ids = [cs.id for cs in self.concept_sets]
        if len(set(ids)) != len(ids):
            raise ValueError("concept_sets ids must be unique")
        by_id = {cs.id: cs for cs in self.concept_sets}

        referenced: set[int] = set()
        domain_mismatches: list[str] = []

        def visit_criterion(criterion: object) -> None:
            concept_set_id = getattr(criterion, "concept_set_id", None)
            if concept_set_id is None:
                return
            referenced.add(concept_set_id)
            concept_set = by_id.get(concept_set_id)
            criterion_type = getattr(criterion, "criterion_type", None)
            expected = _EXPECTED_DOMAIN_BY_CRITERION_TYPE.get(criterion_type or "")
            if concept_set is not None and expected:
                actual = {item.concept.domain_id for item in concept_set.items}
                if not actual & expected:
                    domain_mismatches.append(
                        f"{criterion_type} references concept_set {concept_set_id} "
                        f"('{concept_set.name}'), whose concepts are domain {sorted(actual)}, "
                        f"expected one of {sorted(expected)}"
                    )

        def visit_group(group: CriteriaGroup) -> None:
            for correlated in group.criteria_list:
                visit_criterion(correlated.criterion)
                if correlated.criterion.correlated_criteria is not None:
                    visit_group(correlated.criterion.correlated_criteria)
            for nested in group.groups:
                visit_group(nested)

        for criterion in self.primary_criteria.criteria_list:
            visit_criterion(criterion)
            if getattr(criterion, "correlated_criteria", None) is not None:
                visit_group(criterion.correlated_criteria)

        for rule in self.inclusion_rules:
            visit_group(rule.expression)

        for criterion in self.censoring_criteria:
            visit_criterion(criterion)

        if isinstance(self.end_strategy, CustomEraEndStrategy):
            referenced.add(self.end_strategy.drug_concept_set_id)

        missing = referenced - set(ids)
        if missing:
            raise ValueError(f"references unknown concept_set id(s): {sorted(missing)}")
        if domain_mismatches:
            raise ValueError("; ".join(domain_mismatches))
        return self


@beta_tool
def define_cohort(cohort: CohortExpression) -> str:
    """Define an OMOP-style patient cohort, modeled on OHDSI Atlas's cohort-expression format.

    Validates and normalizes a structured cohort definition: concept sets
    (look up concept_ids with search_atlas_vocabulary first), the primary
    (index-defining) criteria, demographic filters, nested inclusion rules
    with correlated criteria and time windows, censoring criteria, an end
    strategy, and collapse settings. Returns the normalized definition as
    JSON. This only builds and validates the definition -- it doesn't yet
    compile/execute it against the OMOP database.

    Args:
        cohort: The cohort definition to validate and normalize.
    """
    return cohort.model_dump_json(indent=2)
