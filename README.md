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
The prototype needs to reach three destinations, and a live smoke test in a
default-policy sandbox confirmed each behaves differently:

| Destination | Port | Status in a default sandbox | Why |
|---|---|---|---|
| `api.anthropic.com` | 443 | ✅ Works out of the box | Already on the default allowlist |
| `atlas-demo.ohdsi.org` | 443 | ❌ Blocked (`403` from the egress proxy) | Not on the default allowlist — an admin needs to add this host in the environment's settings |
| Your Postgres host (from `DATABASE_URL`) | usually 5432 | ❌ Blocked (connection timeout, not a 403) | Raw TCP database connections aren't proxied at all in this setup — see below, this isn't just an allowlist gap |

### Atlas: an allowlist fix

The proxy logs an explicit policy denial (`gateway answered 403 to CONNECT`)
for hosts that aren't allowed. Adding `atlas-demo.ohdsi.org` to the
environment's allowed hosts (in the Claude Code on the web environment
settings) should resolve this — it's a one-line addition, not an
architectural problem.

### Postgres: not just an allowlist fix

Unlike Atlas, the Postgres connection doesn't fail with a proxy `403` — it
hangs and times out. That's because this sandbox's egress proxy only
tunnels HTTP(S); raw-TCP protocols (including the Postgres wire protocol)
aren't supported through it at all, regardless of allowlisting. Two ways
around this:

- **Unrestricted egress.** If the environment can be configured for
  unrestricted egress instead of the HTTP-only allowlist proxy, raw TCP to
  the database host should work directly.
- **An HTTP-based DB access path.** Some managed Postgres providers (e.g.
  Neon) expose a REST/HTTP query interface as an alternative to the raw
  wire protocol. If your provider offers one with client support for your
  language, it would route through the same HTTPS path that already works
  for the Claude API — but this means swapping out `psycopg` for an
  HTTP-based client, not just a config change.

If neither is available, treat this as a known limitation of running
against a raw-TCP database from this environment, not a bug in this
project's code — the credentials and query logic have been verified to
work correctly once the connection can be established.
