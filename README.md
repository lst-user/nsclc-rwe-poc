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
gives Claude three tools:

- `query_omop_database` — read-only SQL (`SELECT`/`WITH` only) against a
  hosted Postgres instance holding an OMOP CDM, executed over Neon's
  SQL-over-HTTP endpoint rather than the raw Postgres wire protocol.
- `search_atlas_vocabulary` — vocabulary search against an OHDSI Atlas
  WebAPI instance (defaults to the public demo at `atlas-demo.ohdsi.org`).
- `define_cohort` — validates and normalizes a structured, OMOP-style
  cohort definition (condition/drug concept sets, age/sex/race
  demographics, observation window). See "Cohort definitions" below;
  it doesn't execute the cohort against the database yet.

Claude decides when to call each tool via the Anthropic SDK's beta tool
runner (`client.beta.messages.tool_runner`), which drives the request →
execute → loop cycle automatically.

## Project layout

```
src/nsclc_rwe/
  config.py   # env-based settings (DATABASE_URL, ATLAS_BASE_URL, ...)
  db.py       # read-only Postgres query helper (Neon SQL-over-HTTP)
  atlas.py    # OHDSI Atlas WebAPI client
  cohort.py   # OMOP-style cohort definition schema + define_cohort tool
  tools.py    # @beta_tool-decorated tool functions
  agent.py    # entry point that runs the tool-use loop
tests/
  test_config.py
  test_cohort.py
scripts/
  load_omop_data.py  # one-off loader for sample OMOP CDM data (see below)
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
proving the query pipeline works end-to-end, but don't expect NSCLC-specific
results from it. Also, three tables (`drug_exposure`, `measurement`,
`observation`) are loaded without a primary key: their source CSVs contain a
few thousand duplicate surrogate-key values, a data-quality quirk in this
particular trimmed export rather than something the loader introduces.

## Cohort definitions

`cohort.py` defines an OMOP-style cohort definition as a set of Pydantic
models, modeled loosely on OHDSI Atlas's own cohort-expression JSON
(`ConceptSets` + `PrimaryCriteria` + `DemographicCriteria` +
`ObservationWindow`), scoped to what this prototype needs: condition/drug
concept sets, age/sex/race demographics, and an observation window around
the cohort's index date. Atlas's real format also covers inclusion-rule
groups, censoring criteria, and several other criterion types (Visit,
Measurement, Procedure, Death, ...); those aren't modeled here.

The `define_cohort` tool (built from those models via `@beta_tool`, so its
JSON schema is generated the same way as the other tools rather than
hand-written) validates and normalizes a cohort definition — it checks
things like "every criterion references a concept set that actually
exists" and "an age range has both bounds" — and returns it as JSON. It
doesn't execute the cohort against the database yet; that would mean
compiling this structure into SQL against the OMOP tables, which is a
natural next step but isn't built.

Example input, drafting an NSCLC-on-osimertinib cohort (concept IDs would
normally come from `search_atlas_vocabulary`):

```json
{
  "cohort": {
    "name": "Advanced NSCLC on osimertinib, 18-89",
    "concept_sets": [
      {
        "id": 0, "name": "Non-small cell lung cancer", "domain": "Condition",
        "items": [{"concept_id": 4115276, "concept_name": "Non-small cell lung cancer"}]
      },
      {
        "id": 1, "name": "Osimertinib", "domain": "Drug",
        "items": [{"concept_id": 35604931, "concept_name": "Osimertinib"}]
      }
    ],
    "primary_criteria": {
      "condition_occurrences": [{"concept_set_id": 0}],
      "drug_exposures": [{"concept_set_id": 1}],
      "combination": "ALL",
      "observation_window": {"prior_days": 365, "post_days": 0}
    },
    "demographic_criteria": {"age": {"op": "between", "value": 18, "value_upper": 89}}
  }
}
```

## Run

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
