"""OMOP-style cohort definition, modeled on OHDSI Atlas's CIRCE cohort-
expression JSON (see https://github.com/OHDSI/circe-be), field names
included: this mirrors Atlas's actual JSON keys, verified by live-fetching
several real cohort definitions from atlas-demo.ohdsi.org's WebAPI
(e.g. /cohortdefinition/99285, /cohortdefinition/101431, /cohortdefinition/158059)
rather than reconstructed from memory.

Real Atlas's own casing is genuinely inconsistent, and this mirrors that
rather than imposing a cleaner convention of its own:

- Most criteria/structural fields are PascalCase (`CodesetId`, `Age`, `Type`).
- `ConceptSet` and `InclusionRule`'s own wrapper keys are camelCase
  (`id`, `name`, `expression`) -- confirmed live, distinct from the
  PascalCase criteria fields nested inside them.
- `cdmVersionRange` is camelCase, an outlier among top-level keys.
- Concept row fields (`CONCEPT_ID`, `CONCEPT_NAME`, ...) are
  SCREAMING_SNAKE_CASE, matching the OMOP CDM's own column names and
  search_atlas_vocabulary's output.

Two remaining *intentional* deviations (kept even after aligning field
names, because they materially reduce how often a model fills the schema
in wrong):

- Criteria are tagged with an explicit `criterion_type` discriminator field
  instead of Atlas's "exactly one key present" polymorphism (e.g.
  `{"ConditionOccurrence": {...}}`). The discriminator values are still the
  same strings Atlas itself uses for those keys.
- `Occurrence.Type` and `Window` endpoints' `Coeff` use descriptive string
  values (`"at_least"`, `"before"`) instead of Atlas's numeric codes
  (`Type: 0/1/2`, `Coeff: -1/1`). The field names themselves (`Type`,
  `Coeff`) match Atlas; only the values differ.

Everything else -- including the `AdditionalCriteria` top-level field,
`*TypeExclude` flags paired with each `*Type` filter, `{"Type": ...}`
wrapper objects for the three limit fields, and using full Concept objects
(not bare concept_ids) for filter fields like `Gender`/`Unit`/`RouteConcept`
-- was found missing or simplified in an earlier version of this file and
has been corrected here to match confirmed live Atlas output.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from anthropic import beta_tool
from pydantic import BaseModel, Field, model_validator

# --------------------------------------------------------------------------
# Primitives
# --------------------------------------------------------------------------


class Concept(BaseModel):
    """An OMOP standard concept row, matching search_atlas_vocabulary's output
    and real Atlas's own concept JSON shape (SCREAMING_SNAKE_CASE keys)."""

    CONCEPT_ID: int
    CONCEPT_NAME: str
    DOMAIN_ID: str = Field(description="OMOP domain, e.g. 'Condition', 'Drug', 'Procedure'")
    VOCABULARY_ID: str = Field(description="Source vocabulary, e.g. 'SNOMED', 'RxNorm'")
    STANDARD_CONCEPT: Literal["S", "C", None] = Field(
        default=None, description="'S' standard, 'C' classification, null if non-standard"
    )
    STANDARD_CONCEPT_CAPTION: str | None = None
    INVALID_REASON: Literal["D", "U", "V", None] = None
    INVALID_REASON_CAPTION: str | None = None
    CONCEPT_CODE: str | None = None
    CONCEPT_CLASS_ID: str | None = None


class NumericRange(BaseModel):
    """A numeric comparison, used for Age, Quantity, Value, etc. (Atlas's NumericRange)."""

    Op: Literal["lt", "lte", "eq", "neq", "gt", "gte", "bt", "nbt"] = Field(
        description="bt/nbt (between/not between) require Extent"
    )
    Value: float
    Extent: float | None = Field(default=None, description="Upper bound; required when Op is 'bt' or 'nbt'")

    @model_validator(mode="after")
    def _between_needs_extent(self) -> "NumericRange":
        if self.Op in ("bt", "nbt") and self.Extent is None:
            raise ValueError("Extent is required when Op is 'bt' or 'nbt'")
        return self


class DateRange(BaseModel):
    """A date comparison, used for OccurrenceStartDate/EndDate etc. (Atlas's DateRange)."""

    Op: Literal["lt", "lte", "eq", "neq", "gt", "gte", "bt", "nbt"]
    Value: str = Field(description="ISO 8601 date, e.g. '2020-01-01'")
    Extent: str | None = Field(default=None, description="Upper bound; required when Op is 'bt' or 'nbt'")

    @model_validator(mode="after")
    def _between_needs_extent(self) -> "DateRange":
        if self.Op in ("bt", "nbt") and self.Extent is None:
            raise ValueError("Extent is required when Op is 'bt' or 'nbt'")
        return self


class TextFilter(BaseModel):
    Op: Literal["contains", "startsWith", "endsWith", "exact"] = "exact"
    Text: str


class WindowEndpoint(BaseModel):
    Days: int | None = Field(default=None, ge=0, description="null means unbounded in this direction")
    Coeff: Literal["before", "after"] = Field(
        default="before",
        description="Direction from the index date. Atlas itself encodes this as -1 (before)/1 (after); "
        "this uses descriptive strings instead, since numeric codes are more error-prone for a model to produce.",
    )


class Window(BaseModel):
    """A time window relative to the index date, used to correlate criteria (Atlas's Window)."""

    Start: WindowEndpoint
    End: WindowEndpoint
    UseIndexEnd: bool = Field(default=False, description="Anchor the window end to the index event's end date")
    UseEventEnd: bool = Field(
        default=False, description="Anchor the window end to this criterion's own event end date"
    )


class OccurrenceSpec(BaseModel):
    """How many times a criterion must occur to qualify (Atlas's Occurrence).

    Atlas's own Type field uses numeric codes (0=Exactly, 1=At Most,
    2=At Least); this uses descriptive string values instead, for the same
    reason as Window.Coeff above. The field name (Type) matches Atlas.
    """

    Type: Literal["at_least", "at_most", "exactly"] = "at_least"
    Count: int = Field(default=1, ge=0)
    IsDistinct: bool = Field(default=False, description="Count distinct occurrences only")


# --------------------------------------------------------------------------
# Concept sets
# --------------------------------------------------------------------------


class ConceptSetItem(BaseModel):
    concept: Concept
    includeDescendants: bool = Field(default=True)
    includeMapped: bool = Field(default=False)
    isExcluded: bool = Field(default=False)


class ConceptSetExpression(BaseModel):
    items: list[ConceptSetItem] = Field(min_length=1)


class ConceptSet(BaseModel):
    id: int = Field(description="Local id referenced by criteria elsewhere in the cohort expression")
    name: str
    expression: ConceptSetExpression


# --------------------------------------------------------------------------
# Demographic criteria (used inside CriteriaGroup.DemographicCriteriaList)
# --------------------------------------------------------------------------


class DemographicCriteria(BaseModel):
    Age: NumericRange | None = None
    Gender: list[Concept] | None = Field(default=None, description="OMOP gender_concept rows, e.g. MALE, FEMALE")
    Race: list[Concept] | None = Field(default=None, description="OMOP race_concept rows")
    Ethnicity: list[Concept] | None = Field(default=None, description="OMOP ethnicity_concept rows")
    OccurrenceStartDate: DateRange | None = None
    OccurrenceEndDate: DateRange | None = None


# --------------------------------------------------------------------------
# Clinical event criteria -- Atlas's ~16 domain-specific criterion types
# --------------------------------------------------------------------------


class _ClinicalEventBase(BaseModel):
    """Fields shared by most event-based criteria (Atlas's common Criteria fields)."""

    CodesetId: int = Field(description="id of a ConceptSet in ConceptSets")
    First: bool = Field(default=False, description="Only the first qualifying occurrence counts")
    OccurrenceStartDate: DateRange | None = None
    OccurrenceEndDate: DateRange | None = None
    Age: NumericRange | None = Field(default=None, description="Age of the person at the event")
    Gender: list[Concept] | None = None
    ProviderSpecialty: list[Concept] | None = None
    VisitType: list[Concept] | None = None
    CorrelatedCriteria: "CriteriaGroup | None" = Field(
        default=None, description="Additional criteria correlated to this event, within their own time windows"
    )


class ConditionOccurrenceCriterion(_ClinicalEventBase):
    criterion_type: Literal["ConditionOccurrence"] = "ConditionOccurrence"
    ConditionType: list[Concept] | None = None
    ConditionTypeExclude: bool = False
    ConditionSourceConcept: int | None = None


class ConditionEraCriterion(BaseModel):
    criterion_type: Literal["ConditionEra"] = "ConditionEra"
    CodesetId: int
    First: bool = False
    EraStartDate: DateRange | None = None
    EraEndDate: DateRange | None = None
    OccurrenceCount: NumericRange | None = None
    EraLength: NumericRange | None = None
    GapDays: NumericRange | None = None
    AgeAtStart: NumericRange | None = None
    AgeAtEnd: NumericRange | None = None
    CorrelatedCriteria: "CriteriaGroup | None" = None


class DrugExposureCriterion(_ClinicalEventBase):
    criterion_type: Literal["DrugExposure"] = "DrugExposure"
    DrugType: list[Concept] | None = None
    DrugTypeExclude: bool = False
    Refills: NumericRange | None = None
    Quantity: NumericRange | None = None
    DaysSupply: NumericRange | None = None
    RouteConcept: list[Concept] | None = None
    DoseUnit: list[Concept] | None = None
    EffectiveDrugDose: NumericRange | None = None
    StopReason: TextFilter | None = None
    LotNumber: TextFilter | None = None
    DrugSourceConcept: int | None = None


class DrugEraCriterion(BaseModel):
    criterion_type: Literal["DrugEra"] = "DrugEra"
    CodesetId: int
    First: bool = False
    EraStartDate: DateRange | None = None
    EraEndDate: DateRange | None = None
    OccurrenceCount: NumericRange | None = None
    EraLength: NumericRange | None = None
    GapDays: NumericRange | None = None
    AgeAtStart: NumericRange | None = None
    AgeAtEnd: NumericRange | None = None
    CorrelatedCriteria: "CriteriaGroup | None" = None


class DoseEraCriterion(BaseModel):
    criterion_type: Literal["DoseEra"] = "DoseEra"
    CodesetId: int
    DoseValue: NumericRange | None = None
    Unit: list[Concept] | None = None
    EraStartDate: DateRange | None = None
    EraEndDate: DateRange | None = None
    EraLength: NumericRange | None = None
    AgeAtStart: NumericRange | None = None
    AgeAtEnd: NumericRange | None = None
    CorrelatedCriteria: "CriteriaGroup | None" = None


class ProcedureOccurrenceCriterion(_ClinicalEventBase):
    criterion_type: Literal["ProcedureOccurrence"] = "ProcedureOccurrence"
    ProcedureType: list[Concept] | None = None
    ProcedureTypeExclude: bool = False
    Modifier: list[Concept] | None = None
    Quantity: NumericRange | None = None
    ProcedureSourceConcept: int | None = None


class MeasurementCriterion(_ClinicalEventBase):
    criterion_type: Literal["Measurement"] = "Measurement"
    MeasurementType: list[Concept] | None = None
    MeasurementTypeExclude: bool = False
    Operator: list[Concept] | None = None
    ValueAsNumber: NumericRange | None = None
    ValueAsConcept: list[Concept] | None = None
    Unit: list[Concept] | None = None
    RangeLow: NumericRange | None = None
    RangeHigh: NumericRange | None = None
    Abnormal: bool | None = None
    MeasurementSourceConcept: int | None = None


class ObservationCriterion(_ClinicalEventBase):
    criterion_type: Literal["Observation"] = "Observation"
    ObservationType: list[Concept] | None = None
    ObservationTypeExclude: bool = False
    ValueAsNumber: NumericRange | None = None
    ValueAsConcept: list[Concept] | None = None
    ValueAsString: TextFilter | None = None
    Qualifier: list[Concept] | None = None
    Unit: list[Concept] | None = None
    ObservationSourceConcept: int | None = None


class DeathCriterion(BaseModel):
    criterion_type: Literal["Death"] = "Death"
    CodesetId: int | None = Field(default=None, description="Optional: restrict to specific cause-of-death concepts")
    OccurrenceStartDate: DateRange | None = None
    DeathType: list[Concept] | None = None
    DeathTypeExclude: bool = False
    DeathSourceConcept: int | None = None
    CorrelatedCriteria: "CriteriaGroup | None" = None


class DeviceExposureCriterion(_ClinicalEventBase):
    criterion_type: Literal["DeviceExposure"] = "DeviceExposure"
    DeviceType: list[Concept] | None = None
    DeviceTypeExclude: bool = False
    UniqueDeviceId: TextFilter | None = None
    Quantity: NumericRange | None = None
    DeviceSourceConcept: int | None = None


class SpecimenCriterion(_ClinicalEventBase):
    criterion_type: Literal["Specimen"] = "Specimen"
    SpecimenType: list[Concept] | None = None
    Quantity: NumericRange | None = None
    Unit: list[Concept] | None = None
    AnatomicSite: list[Concept] | None = None
    DiseaseStatus: list[Concept] | None = None
    SourceId: TextFilter | None = None


class VisitOccurrenceCriterion(BaseModel):
    criterion_type: Literal["VisitOccurrence"] = "VisitOccurrence"
    CodesetId: int = Field(description="id of a ConceptSet identifying the visit type(s)")
    First: bool = False
    OccurrenceStartDate: DateRange | None = None
    OccurrenceEndDate: DateRange | None = None
    Age: NumericRange | None = None
    Gender: list[Concept] | None = None
    VisitLength: NumericRange | None = Field(default=None, description="Visit length in days")
    CorrelatedCriteria: "CriteriaGroup | None" = None


class VisitDetailCriterion(VisitOccurrenceCriterion):
    criterion_type: Literal["VisitDetail"] = "VisitDetail"  # type: ignore[assignment]
    VisitDetailType: list[Concept] | None = None


class ObservationPeriodCriterion(BaseModel):
    criterion_type: Literal["ObservationPeriod"] = "ObservationPeriod"
    PeriodType: list[Concept] | None = None
    PeriodStartDate: DateRange | None = None
    PeriodEndDate: DateRange | None = None
    UserDefinedPeriod: bool = False
    PeriodLength: NumericRange | None = None
    AgeAtStart: NumericRange | None = None
    AgeAtEnd: NumericRange | None = None


class PayerPlanPeriodCriterion(BaseModel):
    criterion_type: Literal["PayerPlanPeriod"] = "PayerPlanPeriod"
    PayerConcept: list[Concept] | None = None
    PlanConcept: list[Concept] | None = None
    SponsorConcept: list[Concept] | None = None
    PeriodStartDate: DateRange | None = None
    PeriodEndDate: DateRange | None = None
    PeriodLength: NumericRange | None = None
    CorrelatedCriteria: "CriteriaGroup | None" = None


class LocationRegionCriterion(BaseModel):
    criterion_type: Literal["LocationRegion"] = "LocationRegion"
    CodesetId: int = Field(description="id of a ConceptSet identifying the region(s)")
    StartDate: DateRange | None = None
    EndDate: DateRange | None = None


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

    Criteria: Criterion
    StartWindow: Window
    EndWindow: Window | None = None
    RestrictVisit: bool = Field(default=False, description="Require the same visit as the index event")
    IgnoreObservationPeriod: bool = False
    Occurrence: OccurrenceSpec = Field(default_factory=OccurrenceSpec)


class CriteriaGroup(BaseModel):
    """A boolean combination of criteria, demographics, and nested groups (Atlas's CriteriaGroup),
    used for InclusionRules, AdditionalCriteria, and a criterion's own CorrelatedCriteria."""

    Type: Literal["ALL", "ANY", "AT_LEAST", "AT_MOST"] = "ALL"
    Count: int | None = Field(default=None, ge=0, description="Required when Type is AT_LEAST or AT_MOST")
    CriteriaList: list[CorrelatedCriteria] = Field(default_factory=list)
    DemographicCriteriaList: list[DemographicCriteria] = Field(default_factory=list)
    Groups: list["CriteriaGroup"] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate(self) -> "CriteriaGroup":
        if self.Type in ("AT_LEAST", "AT_MOST") and self.Count is None:
            raise ValueError("Count is required when Type is AT_LEAST or AT_MOST")
        if not self.CriteriaList and not self.DemographicCriteriaList and not self.Groups:
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


class ObservationWindowSpec(BaseModel):
    PriorDays: int = Field(default=0, ge=0, description="Days of continuous observation required before the index date")
    PostDays: int = Field(default=0, ge=0, description="Days of continuous observation required after the index date")


class CriteriaLimit(BaseModel):
    Type: Literal["First", "All"] = "First"


class PrimaryCriteriaSpec(BaseModel):
    CriteriaList: list[Criterion] = Field(min_length=1, description="Events that can qualify someone for cohort entry")
    ObservationWindow: ObservationWindowSpec = Field(default_factory=ObservationWindowSpec)
    PrimaryCriteriaLimit: CriteriaLimit = Field(
        default_factory=CriteriaLimit, description="Which qualifying event(s) become the index date"
    )


# --------------------------------------------------------------------------
# End strategy, censoring, collapse settings
# --------------------------------------------------------------------------


class DateOffsetStrategyBody(BaseModel):
    DateField: Literal["StartDate", "EndDate"] = "StartDate"
    Offset: int = 0


class DateOffsetEndStrategy(BaseModel):
    strategy_type: Literal["date_offset"] = "date_offset"
    DateOffset: DateOffsetStrategyBody


class CustomEraStrategyBody(BaseModel):
    DrugCodesetId: int = Field(description="id of a Drug ConceptSet defining era continuation")
    GapDays: int = Field(default=0, ge=0, description="Allowed gap (days) between drug eras before the cohort ends")
    Offset: int = 0


class CustomEraEndStrategy(BaseModel):
    strategy_type: Literal["custom_era"] = "custom_era"
    CustomEra: CustomEraStrategyBody


EndStrategySpec = Annotated[Union[DateOffsetEndStrategy, CustomEraEndStrategy], Field(discriminator="strategy_type")]


class CollapseSettingsSpec(BaseModel):
    CollapseType: Literal["ERA", "NONE"] = "ERA"
    EraPad: int = Field(default=0, ge=0, description="Gap (days) allowed between spans before they're merged")


class CensorWindowSpec(BaseModel):
    StartDate: str | None = Field(default=None, description="ISO 8601 date")
    EndDate: str | None = Field(default=None, description="ISO 8601 date")


# --------------------------------------------------------------------------
# Top-level cohort expression
# --------------------------------------------------------------------------


class CohortExpression(BaseModel):
    """An OMOP-style cohort definition, matching OHDSI Atlas's CohortExpression JSON."""

    name: str = Field(description="Short, human-readable cohort name")
    description: str | None = None
    ConceptSets: list[ConceptSet] = Field(min_length=1)
    PrimaryCriteria: PrimaryCriteriaSpec
    AdditionalCriteria: CriteriaGroup | None = Field(
        default=None, description="Criteria applied alongside PrimaryCriteria, outside the named InclusionRules"
    )
    QualifiedLimit: CriteriaLimit = Field(
        default_factory=CriteriaLimit, description="Across all qualifying index events, which one(s) form the cohort"
    )
    ExpressionLimit: CriteriaLimit = Field(
        default_factory=CriteriaLimit, description="Which cohort era(s) per person are kept in the final cohort"
    )
    InclusionRules: list[InclusionRule] = Field(default_factory=list)
    EndStrategy: EndStrategySpec | None = Field(
        default=None, description="How cohort exit is determined; defaults to end of the index event/era"
    )
    CensoringCriteria: list[Criterion] = Field(
        default_factory=list, description="Events that end cohort membership early if observed"
    )
    CollapseSettings: CollapseSettingsSpec = Field(default_factory=CollapseSettingsSpec)
    CensorWindow: CensorWindowSpec | None = None
    cdmVersionRange: str = Field(default=">=5.3.0", description="Informational OMOP CDM version compatibility range")

    @model_validator(mode="after")
    def _validate_concept_set_references(self) -> "CohortExpression":
        ids = [cs.id for cs in self.ConceptSets]
        if len(set(ids)) != len(ids):
            raise ValueError("ConceptSets ids must be unique")
        by_id = {cs.id: cs for cs in self.ConceptSets}

        referenced: set[int] = set()
        domain_mismatches: list[str] = []

        def visit_criterion(criterion: object) -> None:
            codeset_id = getattr(criterion, "CodesetId", None)
            if codeset_id is None:
                return
            referenced.add(codeset_id)
            concept_set = by_id.get(codeset_id)
            criterion_type = getattr(criterion, "criterion_type", None)
            expected = _EXPECTED_DOMAIN_BY_CRITERION_TYPE.get(criterion_type or "")
            if concept_set is not None and expected:
                actual = {item.concept.DOMAIN_ID for item in concept_set.expression.items}
                if not actual & expected:
                    domain_mismatches.append(
                        f"{criterion_type} references concept_set {codeset_id} "
                        f"('{concept_set.name}'), whose concepts are domain {sorted(actual)}, "
                        f"expected one of {sorted(expected)}"
                    )

        def visit_group(group: CriteriaGroup) -> None:
            for correlated in group.CriteriaList:
                visit_criterion(correlated.Criteria)
                nested = getattr(correlated.Criteria, "CorrelatedCriteria", None)
                if nested is not None:
                    visit_group(nested)
            for nested_group in group.Groups:
                visit_group(nested_group)

        for criterion in self.PrimaryCriteria.CriteriaList:
            visit_criterion(criterion)
            nested = getattr(criterion, "CorrelatedCriteria", None)
            if nested is not None:
                visit_group(nested)

        if self.AdditionalCriteria is not None:
            visit_group(self.AdditionalCriteria)

        for rule in self.InclusionRules:
            visit_group(rule.expression)

        for criterion in self.CensoringCriteria:
            visit_criterion(criterion)

        if isinstance(self.EndStrategy, CustomEraEndStrategy):
            referenced.add(self.EndStrategy.CustomEra.DrugCodesetId)

        missing = referenced - set(ids)
        if missing:
            raise ValueError(f"references unknown concept_set id(s): {sorted(missing)}")
        if domain_mismatches:
            raise ValueError("; ".join(domain_mismatches))
        return self


@beta_tool
def define_cohort(cohort: CohortExpression) -> str:
    """Define an OMOP-style patient cohort, matching OHDSI Atlas's cohort-expression format.

    Validates and normalizes a structured cohort definition: concept sets
    (look up concepts with search_atlas_vocabulary first), the primary
    (index-defining) criteria, demographic filters, nested inclusion rules
    with correlated criteria and time windows, censoring criteria, an end
    strategy, and collapse settings. Returns the normalized definition as
    JSON. This only builds and validates the definition -- it doesn't yet
    compile/execute it against the OMOP database.

    Args:
        cohort: The cohort definition to validate and normalize.
    """
    return cohort.model_dump_json(indent=2)
