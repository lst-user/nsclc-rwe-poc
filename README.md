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
tool. There's no cohort-building, no statistical analysis, and no PHI
handling built in yet.

## What's in the repo

Prototype Claude API tool-use agent for NSCLC real-world evidence work. It
gives Claude three tools:

- `query_omop_database` — read-only SQL (`SELECT`/`WITH` only) against a
  hosted Postgres instance holding an OMOP CDM, executed over Neon's
  SQL-over-HTTP endpoint rather than the raw Postgres wire protocol.
- `search_atlas_vocabulary` — vocabulary search against an OHDSI Atlas
  WebAPI instance (defaults to the public demo at `atlas-demo.ohdsi.org`).
- `define_nsclc_cohort` — captures an OMOP-style cohort definition (condition
  concept, optional drug concept, demographics, observation window) that
  Claude has assembled from an analyst's natural-language request. It
  validates and echoes the structured definition back; it does not build or
  query a cohort yet.

Claude decides when to call each tool via the Anthropic SDK's beta tool
runner (`client.beta.messages.tool_runner`), which drives the request →
execute → loop cycle automatically.

## Project layout

```
src/nsclc_rwe/
  config.py         # env-based settings (DATABASE_URL, ATLAS_BASE_URL, ...)
  db.py             # read-only Postgres query helper (Neon SQL-over-HTTP)
  atlas.py          # OHDSI Atlas WebAPI client
  cohort_schema.py  # OMOP-style cohort definition dataclasses + define_nsclc_cohort tool
  tools.py          # @beta_tool-decorated tool functions
  agent.py          # entry point that runs the tool-use loop
tests/
  test_config.py
  test_cohort_schema.py
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

## Run

```bash
python -m nsclc_rwe.agent "Search the Atlas vocabulary for non-small cell lung cancer concepts"
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
