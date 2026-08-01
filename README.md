# nsclc-rwe-poc

## Goal

This is a proof of concept for using Claude as a research assistant over
real-world evidence (RWE) for non-small cell lung cancer (NSCLC). The idea
is to let an analyst ask questions in plain language — about patient
cohorts, drug exposures, outcomes, or standard clinical vocabulary — and
have Claude figure out which underlying data source to query and how,
rather than the analyst hand-writing SQL or navigating the Atlas UI
themselves.

Concretely, it demonstrates Claude's tool-use loop wired to two real
resources a clinical RWE workflow depends on:

- an **OMOP CDM** database (the standardized schema RWE studies are built
  on) for patient-level querying, and
- the **OHDSI Atlas** vocabulary service for mapping natural-language
  clinical terms to standard concepts.

It's intentionally small in scope — a starting point to validate that this
pattern (LLM + OMOP + Atlas) works end-to-end, not a production analytics
tool. There's no statistical analysis and no PHI handling built in yet;
cohort *definition* is a first draft (see below) and isn't yet wired to
execute against the database.

## What's in the repo

Prototype Claude API tool-use agent for NSCLC real-world evidence work. It
gives Claude four tools:

- `query_omop_database` — read-only SQL (`SELECT`/`WITH` only) against a
  hosted Postgres instance holding an OMOP CDM, executed over Neon's
  SQL-over-HTTP endpoint rather than the raw Postgres wire protocol.
- `search_atlas_vocabulary` — vocabulary search against an OHDSI Atlas
  WebAPI instance (defaults to the public demo at `atlas-demo.ohdsi.org`).
- `search_omop_concept` — vocabulary search against the CONCEPT table in
  *this* database's own loaded OMOP vocabulary, filtered by domain.
  Distinct from `search_atlas_vocabulary`: that hits Atlas's external demo
  vocabulary snapshot, which isn't necessarily the same vocabulary as
  what's actually loaded here — use this one when you need a concept_id
  guaranteed to exist in this database. See "Sample data" below for what's
  actually loaded (GiBleed's patient data + a merged-in broader vocabulary,
  since GiBleed's own vocabulary is too narrow on its own).
- `define_cohort` — validates and normalizes a structured, OMOP-style
  cohort definition, modeled on OHDSI Atlas's full CIRCE cohort-expression
  format (concept sets, ~16 clinical-event criterion types, inclusion
  rules, censoring criteria, end strategy). See "Cohort definitions"
  below; it doesn't execute the cohort against the database yet.

Claude decides when to call each tool via the Anthropic SDK's beta tool
runner (`client.beta.messages.tool_runner`), which drives the request →
execute → loop cycle automatically.

## Project layout

```
src/nsclc_rwe/
  config.py   # env-based settings (DATABASE_URL, ATLAS_BASE_URL, ...)
  db.py       # read-only Postgres query helper (Neon SQL-over-HTTP) + search_concept
  atlas.py    # OHDSI Atlas WebAPI client
  cohort.py   # OMOP-style cohort definition schema + define_cohort tool
  tools.py    # @beta_tool-decorated tool functions
  agent.py    # entry point that runs the full 4-tool loop
  nl_to_cohort.py  # entry point: NL question -> cohort definition JSON
tests/
  test_config.py
  test_cohort.py
  test_db.py
  test_nl_to_cohort.py
  test_tools.py
scripts/
  load_omop_data.py         # one-off loader for sample OMOP CDM data (see below)
  merge_vocabulary.py       # one-off: merge in a broader test-dataset vocabulary
  load_athena_vocabulary.py # one-off: merge in the real OHDSI Standardized Vocabularies
```

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # fill in DATABASE_URL; Atlas vars default to the public demo
```

Authenticate to the Claude API either by setting `ANTHROPIC_API_KEY` in
`.env`, or by running `ant auth login` (the SDK picks up that profile
automatically with no env var needed).

### Persisting `DATABASE_URL` in Claude Code on the web

A local `.env` file only lives inside one cloud session's container — it's
gitignored (so it's never committed) and disappears once that session's
container is reclaimed. A fresh session cloning this repo starts with no
`DATABASE_URL` at all.

To make it available automatically in every future cloud session, set it
in the environment's persistent settings instead: click the cloud icon
showing the current environment's name, hover over the environment, click
the settings icon, and add it in the **Environment variables** field.
That field uses `.env` syntax — one `KEY=value` pair per line, no quotes
around the value:

```text
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

Note there's no dedicated secrets store for this yet — anything set there
is stored in plain text and visible to anyone who can edit that
environment.

## Sample data

The hosted Postgres database starts out empty — `query_omop_database` has
nothing to query until an OMOP CDM is loaded into it. For local dev/demo
purposes, `scripts/load_omop_data.py` populates it with
[OHDSI's GiBleed dataset](https://github.com/OHDSI/EunomiaDatasets/tree/main/datasets/GiBleed) —
a small (~2,700 patient), publicly hosted OMOP CDM v5.3 test dataset with a
trimmed vocabulary subset:

```bash
python scripts/load_omop_data.py
```

It downloads the OMOP CDM v5.3 DDL (from OHDSI's `CommonDataModel` repo) and
the GiBleed CSVs (from `EunomiaDatasets`), both over HTTPS from
`raw.githubusercontent.com`, then creates the schema and loads every table
via Neon's SQL-over-HTTP endpoint — the same one `db.py` uses, since raw
Postgres connections don't work in this environment either (see above).
Re-running it is safe: it drops and recreates all 37 tables first.

Note: GiBleed is a GI-bleeding cohort, not lung cancer — it's useful for
proving `query_omop_database`'s pipeline works end-to-end (real patients,
real conditions, real drug exposures), but don't expect NSCLC-specific
*patient* results from it. Also, three tables (`drug_exposure`,
`measurement`, `observation`) are loaded without a primary key: their
source CSVs contain a few thousand duplicate surrogate-key values, a
data-quality quirk in this particular trimmed export rather than something
the loader introduces.

### Broadening the vocabulary for `search_omop_concept`

GiBleed's own `CONCEPT` table is trimmed to just the ~444 concepts its
GI-bleeding cohort needs — `search_omop_concept` returns nothing for
unrelated terms, including anything NSCLC-related. `scripts/merge_vocabulary.py`
fixes that by additively merging in
[OHDSI's Synthea27Nj dataset](https://github.com/OHDSI/EunomiaDatasets/tree/main/datasets/Synthea27Nj)'s
broader vocabulary (~2,300 concepts from a general synthetic population,
including real oncology terms like `Non-small cell lung cancer` and
chemotherapy drugs):

```bash
python scripts/merge_vocabulary.py
```

Run this *after* `load_omop_data.py`. It only touches the `CONCEPT` and
`VOCABULARY` tables, inserting with `ON CONFLICT DO NOTHING` — it adds
concepts GiBleed didn't have, but never overwrites or removes anything, so
GiBleed's already-loaded patient records still join correctly against the
concepts they reference. Safe to re-run (idempotent).

This only broadens the *vocabulary* (what `search_omop_concept` can find),
not the *patient data* — the loaded patients are still GiBleed's
GI-bleeding cohort. Getting real NSCLC-cohort patient data into
`query_omop_database` would be a separate, larger effort (see README's
"Sample data" caveat above); this fix is specifically about making
concept lookup work for cohort-definition building.

Synthea27Nj's vocabulary still has real gaps — testing surfaced that
neither `osimertinib`/`Tagrisso` nor `Asian` (race) existed locally even
after this merge, despite both being real, standard OMOP concepts. For
those, `scripts/load_athena_vocabulary.py` additively merges in a filtered
slice of the actual [OHDSI Standardized Vocabularies](https://athena.ohdsi.org)
(SNOMED, RxNorm, etc.). Unlike GiBleed/Synthea27Nj, this isn't a public,
no-license-gate download — it requires a personal Athena account (and a
separate UMLS account for SNOMED/LOINC) and license acceptance, so it
can't be fetched automatically. Download it yourself from
[athena.ohdsi.org](https://athena.ohdsi.org), then pass the path to the
zip it emails you:

```bash
python scripts/load_athena_vocabulary.py /path/to/vocabulary_download_v5_*.zip
```

The full download's `CONCEPT.csv` is ~6.4M rows (2.7M standard), and
`CONCEPT_RELATIONSHIP`/`CONCEPT_ANCESTOR` run into the tens of millions —
loading all of it through Neon's SQL-over-HTTP endpoint (no bulk `COPY`
available in this sandbox) isn't practical. This script only loads
`CONCEPT` rows that are both standard (`STANDARD_CONCEPT='S'`) and in a
clinically relevant domain (Condition, Drug, Procedure, Measurement,
Observation, Device, Specimen, Visit, Race, Ethnicity, Gender), and within
Drug additionally drops NDC-package/box-level concept classes (Marketed
Product, `*Box`, `Quant *`, `*Pack*` — the bulk of RxNorm Extension's row
count, not useful for cohort concept sets). `CONCEPT_RELATIONSHIP`,
`CONCEPT_ANCESTOR`, `CONCEPT_SYNONYM`, `DRUG_STRENGTH`, and `CONCEPT_CPT4`
are skipped entirely — nothing in this repo uses them today, and CPT4
additionally needs a separate UMLS-keyed decode step. This brings the load
down to ~1.2M rows (~20-25 minutes at this sandbox's measured throughput),
from what would otherwise be a multi-hour-plus job. Same `ON CONFLICT DO
NOTHING` merge approach as `merge_vocabulary.py` — additive only, safe to
re-run, doesn't touch patient data.

## Cohort definitions

`cohort.py` defines an OMOP-style cohort definition as a set of Pydantic
models, matching OHDSI Atlas's own CIRCE cohort-expression JSON field names
(see [circe-be](https://github.com/OHDSI/circe-be)) — verified by live-fetching
several real cohort definitions from `atlas-demo.ohdsi.org`'s WebAPI
(`/cohortdefinition/99285`, `/101431`, `/158059`) rather than reconstructed
from memory:

- **Concept sets** (`ConceptSets`) of standard OMOP concepts
  (`includeDescendants`/`includeMapped`/`isExcluded` flags).
- **~16 clinical-event criterion types** — `ConditionOccurrence`, `DrugExposure`,
  `ProcedureOccurrence`, `Measurement`, `Observation`, `Death`, `DeviceExposure`,
  `Specimen`, `VisitOccurrence`, `VisitDetail`, `ObservationPeriod`,
  `ConditionEra`, `DrugEra`, `DoseEra`, `PayerPlanPeriod`, `LocationRegion` —
  as a discriminated union (`criterion_type`), each with its own domain-specific
  filters (e.g. `Measurement.ValueAsNumber`, `DrugExposure.DaysSupply`) and,
  where Atlas has one, a `*TypeExclude` flag alongside its `*Type` filter.
- **Primary criteria** (`PrimaryCriteria`) defining the cohort index event,
  plus a same-shaped top-level `AdditionalCriteria` group applied alongside it.
- **Inclusion rules** (`InclusionRules`): recursive `CriteriaGroup`s
  (`ALL`/`ANY`/`AT_LEAST`/`AT_MOST`) combining correlated criteria (each
  within its own `Window` relative to the index date), demographic filters
  (age/gender/race/ethnicity), and nested subgroups.
- **Censoring criteria**, an **end strategy** (`DateOffset` or `CustomEra`),
  and **collapse settings**.

Real Atlas's own casing is genuinely inconsistent, and this mirrors that
rather than imposing a cleaner convention: most criteria/structural fields
are PascalCase (`CodesetId`, `Age`), `ConceptSet`/`InclusionRule`'s own
wrapper keys are camelCase (`id`, `name`, `expression`), `cdmVersionRange`
is camelCase, and concept rows are SCREAMING_SNAKE_CASE (`CONCEPT_ID`,
matching `search_atlas_vocabulary`'s own output, so results from one tool
can be dropped straight into the other without reshaping).

Two remaining *intentional* deviations, documented in the module docstring:
criteria carry an explicit `criterion_type` discriminator instead of
Atlas's "exactly one key present" polymorphism (e.g. `{"ConditionOccurrence": {...}}`),
and `Occurrence.Type`/`Window`'s `Coeff` use descriptive strings
(`"at_least"`, `"before"`) instead of Atlas's numeric codes (`Type: 0/1/2`,
`Coeff: -1/1`) — the field names match Atlas either way, only these two
values don't. Concept sets have no fixed domain, same as real Atlas — the
validator instead checks that concept sets referenced by a given criterion
type actually contain concepts of the expected domain (e.g. a
`DrugExposure` criterion pointing at a concept set full of `Condition`
concepts is rejected), for the domains where that's well-defined.

The `define_cohort` tool (built from those models via `@beta_tool`, so its
JSON schema is generated the same way as the other tools rather than
hand-written) validates and normalizes a cohort definition — referential
integrity between criteria/`AdditionalCriteria`/`EndStrategy` and concept
sets, criterion/concept-set domain agreement, `AT_LEAST`/`AT_MOST` groups
having a `Count`, `bt`/`nbt` ranges having an `Extent` — and returns it as
JSON.

### Running a cohort definition on Atlas

`AtlasClient.run_cohort(name, cohort_expression, source_key=None)` takes a
`define_cohort()` result and executes it for real: POSTs it to Atlas's
`/cohortdefinition` endpoint, triggers generation against a CDM data source
(`/cohortdefinition/{id}/generate/{sourceKey}`, an async job), polls
`/cohortdefinition/{id}/info` until it completes, and returns the person
count. `create_cohort_definition`, `generate_cohort`, and `get_cohort_count`
are also available individually.

Since `cohort.py`'s internal representation deliberately deviates from
Atlas's own wire format (the explicit `criterion_type`/`strategy_type`
discriminators and descriptive `Occurrence.Type`/`Window.Coeff` strings
documented above), `_to_atlas_expression()` translates one into the other
first. Verified live against `atlas-demo.ohdsi.org`: a real NSCLC +
osimertinib + Asian-women cohort round-tripped through `create_cohort_definition`
→ `generate_cohort` → `get_cohort_count` against `SYNPUF1K`, matching the
translation rules found by comparing against real fetched cohort definitions
(`/cohortdefinition/99285`, `/101431`, `/158059`).

`AtlasClient.get_cohort_report(cohort_id, source_key=None)` fetches Atlas's
inclusion-rule attrition report for an already-generated cohort
(`/cohortdefinition/{id}/report/{sourceKey}`) — how many people matched the
primary criteria (`baseCount`), how many remained after each inclusion rule,
and the final count. A separate, deeper per-analysis characterization
endpoint (`/cohortresults/{sourceKey}/{id}`, Achilles-style age/gender/
condition breakdowns) exists on the server but its detail-retrieval shape
isn't documented anywhere reachable from this demo instance and wasn't
findable by trial and error within reasonable effort, so it isn't wired up.

### Summarizing cohort results with Claude

`summarize.py`'s `summarize_cohort_results(cohort_result, client=None)` takes
a `{"name", "source_key", "person_count", "report"}` dict — the outputs of
`run_cohort()` and `get_cohort_report()` — and asks Claude for a short,
abstract-style summary paragraph. The system prompt instructs it to ground
every sentence in the numbers given and not invent patient-level detail
(demographics, dates, outcomes) that wasn't actually retrieved, since only
aggregate counts and attrition stats are available, not row-level data.
`client` is injectable for testing; defaults to `anthropic.Anthropic()`.

Verified live: a real "Malignant tumor of lung, treated with erlotinib"
cohort (3,880 base population → 3 final, `SYNPUF5PCT`) produced:

> We conducted a retrospective cohort study using the SYNPUF5PCT data source
> to identify patients with a malignant tumor of the lung who were
> subsequently treated with erlotinib. From a base population of 3,880
> individuals with a lung malignancy, we applied a single inclusion
> criterion requiring treatment with erlotinib on or after diagnosis. This
> rule excluded 99.92% of the base population, leaving 3 patients (0.08%)
> who satisfied the requirement. The final cohort therefore comprised 3
> persons.

Example: an NSCLC cohort on first-line osimertinib, excluding patients with
baseline brain metastasis, ending the cohort era on a gap in drug exposure
(concepts would normally come from `search_atlas_vocabulary`):

```json
{
  "cohort": {
    "name": "Advanced NSCLC, EGFR TKI treated, no baseline brain mets",
    "ConceptSets": [
      {"id": 0, "name": "NSCLC", "expression": {"items": [
        {"concept": {"CONCEPT_ID": 4115276, "CONCEPT_NAME": "Non-small cell lung cancer", "DOMAIN_ID": "Condition", "VOCABULARY_ID": "SNOMED", "STANDARD_CONCEPT": "S"}}
      ]}},
      {"id": 1, "name": "Osimertinib", "expression": {"items": [
        {"concept": {"CONCEPT_ID": 35604931, "CONCEPT_NAME": "Osimertinib", "DOMAIN_ID": "Drug", "VOCABULARY_ID": "RxNorm", "STANDARD_CONCEPT": "S"}}
      ]}},
      {"id": 2, "name": "Brain metastasis", "expression": {"items": [
        {"concept": {"CONCEPT_ID": 4300544, "CONCEPT_NAME": "Secondary malignant neoplasm of brain", "DOMAIN_ID": "Condition", "VOCABULARY_ID": "SNOMED", "STANDARD_CONCEPT": "S"}}
      ]}}
    ],
    "PrimaryCriteria": {
      "CriteriaList": [{"criterion_type": "DrugExposure", "CodesetId": 1, "First": true}],
      "ObservationWindow": {"PriorDays": 365, "PostDays": 0}
    },
    "InclusionRules": [
      {
        "name": "Has NSCLC diagnosis before or on index",
        "expression": {
          "Type": "ALL",
          "CriteriaList": [{
            "Criteria": {"criterion_type": "ConditionOccurrence", "CodesetId": 0},
            "StartWindow": {"Start": {"Coeff": "before"}, "End": {"Days": 0, "Coeff": "after"}}
          }]
        }
      },
      {
        "name": "No brain metastasis before index",
        "expression": {
          "Type": "AT_MOST",
          "Count": 0,
          "CriteriaList": [{
            "Criteria": {"criterion_type": "ConditionOccurrence", "CodesetId": 2},
            "StartWindow": {"Start": {"Coeff": "before"}, "End": {"Days": 0, "Coeff": "before"}}
          }]
        }
      }
    ],
    "EndStrategy": {"strategy_type": "custom_era", "CustomEra": {"DrugCodesetId": 1, "GapDays": 30}}
  }
}
```

### Drafting a cohort definition from a natural-language question

`nl_to_cohort.py` is a focused entry point (separate from `agent.py`'s full
4-tool loop) that gives Claude only `search_omop_concept` and `define_cohort`,
then drives the tool loop until `define_cohort` succeeds:

```bash
python -m nsclc_rwe.nl_to_cohort "Adults with NSCLC on first-line osimertinib" > cohort.json
```

Claude looks up real concept_ids with `search_omop_concept` first (never
inventing one), then calls `define_cohort`; if that returns a validation
error, Claude sees it and retries with a corrected definition. Progress
(Claude's own commentary, each tool call) goes to stderr, so only the final,
validated cohort definition JSON lands on stdout — safe to redirect straight
to a file. Loops for at most 12 turns before giving up.

## Run

`main.py` is an interactive loop tying the whole pipeline together end to
end: type a clinical question, and for each one see the cohort definition
JSON Claude builds (`nl_to_cohort`), the result of actually running it
against a real Atlas WebAPI CDM data source (`atlas.py`), and a short
narrative summary of those results (`summarize.py`). Blank line or Ctrl-D
to quit.

```bash
python main.py
```

```bash
python -m nsclc_rwe.agent "Search the Atlas vocabulary for non-small cell lung cancer concepts"
```

```bash
python -m nsclc_rwe.agent "How many patients are in the OMOP database, and what are the five most common conditions?"
```

## Tests

```bash
pytest
```

## Network access this needs

This runs in a cloud sandbox, so outbound network access is gated by the
environment's network policy (set when the environment was created — see
the [Claude Code on the web docs](https://code.claude.com/docs/en/claude-code-on-the-web)).
The prototype needs to reach two destinations, both over plain HTTPS:

| Destination | Port | Status | Why |
|---|---|---|---|
| `api.anthropic.com` | 443 | ✅ Works out of the box | Already on the default allowlist |
| `atlas-demo.ohdsi.org` | 443 | ✅ Works once allowlisted | Not on the default allowlist — added to this environment's allowed hosts and verified live (`AtlasClient.info()` returned a real response from WebAPI 2.14.0) |
| Your Postgres host (from `DATABASE_URL`) | 443 (HTTPS) | ✅ Works | `db.py` talks to Neon's SQL-over-HTTP endpoint (`https://<host>/sql`), not the raw Postgres wire protocol — see below |

### Atlas: an allowlist fix (done)

The proxy logs an explicit policy denial (`gateway answered 403 to CONNECT`)
for hosts that aren't allowed. Adding `atlas-demo.ohdsi.org` to the
environment's allowed hosts (in the Claude Code on the web environment
settings) resolved this — no code changes needed, and the change took
effect without restarting the session.

### Postgres: swapped the wire protocol for HTTP

This sandbox's egress proxy only tunnels HTTP(S); raw-TCP protocols
(including the Postgres wire protocol on port 5432) aren't supported
through it at all, regardless of allowlisting — connections just hang and
time out. Since the hosted database is on Neon, `db.py` avoids this
entirely by using [Neon's SQL-over-HTTP endpoint](https://neon.tech/docs/serverless/serverless-driver#use-the-driver-over-http)
instead of `psycopg`:

- Each query is a `POST https://<host>/sql` with the connection string in
  a `Neon-Connection-String` header and the SQL in a JSON body — plain
  HTTPS, so it goes through the same proxy path that already works for
  the Claude API and Atlas.
- Read-only enforcement and the statement timeout are still applied by
  Postgres itself (not just the client-side regex check): each request
  batches `SET TRANSACTION READ ONLY`, `SET statement_timeout`, and the
  query itself into one implicit transaction via the endpoint's `queries`
  array, so a write is rejected by Postgres (`cannot execute ... in a
  read-only transaction`), not just filtered by the app.
- This only works because Neon exposes this endpoint. A provider without
  an HTTP query interface would still need unrestricted egress (or a
  different network path) for raw TCP to work in this environment.
