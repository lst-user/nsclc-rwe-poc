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
gives Claude two tools:

- `query_omop_database` — read-only SQL (`SELECT`/`WITH` only) against a
  hosted Postgres instance holding an OMOP CDM.
- `search_atlas_vocabulary` — vocabulary search against an OHDSI Atlas
  WebAPI instance (defaults to the public demo at `atlas-demo.ohdsi.org`).

Claude decides when to call each tool via the Anthropic SDK's beta tool
runner (`client.beta.messages.tool_runner`), which drives the request →
execute → loop cycle automatically.

## Project layout

```
src/nsclc_rwe/
  config.py   # env-based settings (DATABASE_URL, ATLAS_BASE_URL, ...)
  db.py       # read-only Postgres query helper
  atlas.py    # OHDSI Atlas WebAPI client
  tools.py    # @beta_tool-decorated tool functions
  agent.py    # entry point that runs the tool-use loop
tests/
  test_config.py
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
For this prototype to work, the sandbox's egress needs to reach, over
HTTPS/TCP:

| Destination | Port | Why |
|---|---|---|
| `api.anthropic.com` | 443 | Claude API calls made by the `anthropic` SDK |
| Your Postgres host (from `DATABASE_URL`) | usually 5432, or whatever your provider uses | Raw Postgres wire protocol — **not** HTTP, so an HTTP-only allowlist won't cover it |
| `atlas-demo.ohdsi.org` | 443 | OHDSI Atlas WebAPI calls |

If the environment is configured with unrestricted egress, none of this
needs any action. If it's configured with an allowlist, add the three hosts
above explicitly — check the environment's settings in the Claude Code web
UI (or ask Claude to explain the current policy, since it's visible from
inside the session).

Two gotchas specific to the Postgres leg:

- **It's TCP, not HTTP.** An allowlist that only permits HTTPS domains won't
  let the `psycopg` connection through. Some managed Postgres providers
  (e.g. Neon, Supabase) also offer an HTTP-based/serverless driver that
  tunnels over 443 — worth considering if the sandbox's network policy is
  HTTP-only and can't be changed.
- **IP allowlisting on the database side.** If your Postgres provider
  restricts inbound connections by source IP (e.g. AWS RDS security groups,
  Supabase/Neon IP restrictions), you also need to allow the sandbox's
  egress IP range there — and that range may not be static, so check your
  provider's docs for how to handle non-static egress (or open access more
  broadly and rely on the read-only DB user + TLS instead).
