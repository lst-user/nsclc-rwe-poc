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
  Neon-hosted Postgres instance holding an OMOP CDM, run over Neon's
  SQL-over-HTTP endpoint rather than the raw wire protocol (see
  [Network access](#network-access-this-needs)).
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
The prototype needs to reach three destinations:

| Destination | Port | Status | Why |
|---|---|---|---|
| `api.anthropic.com` | 443 | ✅ Works out of the box | Already on the default allowlist — re-checked 2026-07-22, live `401` from Cloudflare (invalid test key, but a real server response, not a proxy denial) |
| `atlas-demo.ohdsi.org` | 443 | ✅ Works once allowlisted | Not on the default allowlist — added to this environment's allowed hosts; re-verified live 2026-07-22 (`AtlasClient.info()` returned a real response from WebAPI 2.14.0) |
| Your Postgres host (from `DATABASE_URL`), raw wire protocol | 5432 | ❌ Blocked (connection timeout, not a 403) | Raw TCP isn't proxied at all in this setup — see below |
| Your Neon host, SQL-over-HTTP (`https://<host>/sql`) | 443 | ✅ Works | Same HTTPS path as everything else — `db.py` now queries through this instead of raw Postgres wire protocol |

### Atlas: an allowlist fix (done)

The proxy logs an explicit policy denial (`gateway answered 403 to CONNECT`)
for hosts that aren't allowed. Adding `atlas-demo.ohdsi.org` to the
environment's allowed hosts (in the Claude Code on the web environment
settings) resolved this — no code changes needed, and the change took
effect without restarting the session.

### Postgres: not just an allowlist fix (worked around via Neon's HTTP endpoint)

Unlike Atlas, the raw Postgres connection doesn't fail with a proxy `403`
— it hangs and times out. That's because this sandbox's egress proxy only
tunnels HTTP(S); raw-TCP protocols (including the Postgres wire protocol)
aren't supported through it at all, regardless of allowlisting or valid
credentials. Confirmed 2026-07-22: both `psycopg.connect()` and a raw TCP
probe to port 5432 hung until timeout against a real Neon `DATABASE_URL`.

Since the database is Neon-hosted, `db.py` now queries it over Neon's
**SQL-over-HTTP** endpoint instead: `POST https://<host>/sql` with the
connection string passed as a `Neon-Connection-String` header and the SQL
text as a JSON body — the same protocol the `@neondatabase/serverless` JS
driver uses under the hood. This is a plain HTTPS request, so it goes
through the same proxy path that already works for the Claude API and
Atlas. Verified live 2026-07-22 (`select version()` returned a real
response from the Neon Postgres instance).

This fix is Neon-specific — it relies on a feature of Neon's hosting, not
a standard Postgres capability, so it wouldn't work unmodified against a
self-hosted or non-Neon-managed Postgres instance. For those, the options
are still:

- **Unrestricted egress**, if the environment can be configured for it —
  raw TCP to the database host would work directly.
- **Whatever HTTP-based access path your provider offers**, if any,
  swapped in the same way `db.py` did here.
