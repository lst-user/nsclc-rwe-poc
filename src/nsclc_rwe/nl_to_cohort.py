"""Natural language -> OMOP cohort definition, via Claude's tool-use loop.

Gives Claude two tools -- search_omop_concept (to find real concept_ids in
this database's own vocabulary) and define_cohort (to validate a structured
cohort definition) -- and drives the tool loop until define_cohort succeeds.
Progress (Claude's own commentary, each tool call) goes to stderr; the final
cohort definition JSON is the only thing printed to stdout, so this can be
piped straight into a file:

    python -m nsclc_rwe.nl_to_cohort "Adults with NSCLC on osimertinib" > cohort.json
"""

import json
import sys

import anthropic

from .cohort import define_cohort
from .config import load_settings
from .tools import search_omop_concept

MAX_ITERATIONS = 12

SYSTEM_PROMPT = """\
You translate a natural-language clinical question into a single, complete \
OMOP-style cohort definition.

1. Identify the clinical concepts the question needs (conditions, drugs, \
procedures, ...).
2. For each one, call search_omop_concept to find a real, standard \
concept_id in this database's own vocabulary. Never invent a concept_id.
3. Once you have real concept_ids for everything you need, call \
define_cohort with a complete cohort definition covering the question.
4. If define_cohort returns a validation error, fix the definition and call \
it again. Keep retrying until it succeeds -- a validated cohort definition \
is the deliverable, not a text explanation of one.\
"""


def extract_cohort_result(block) -> str | None:
    """If `block` is a successful define_cohort tool_use, return its JSON result.

    Returns None for any other block, or if define_cohort's own validation
    rejected the input (Claude is expected to see that error and retry).
    """
    if getattr(block, "type", None) != "tool_use" or getattr(block, "name", None) != "define_cohort":
        return None
    try:
        return define_cohort.call(block.input)
    except Exception:
        return None


def main() -> None:
    question = " ".join(sys.argv[1:])
    if not question:
        raise SystemExit('Usage: python -m nsclc_rwe.nl_to_cohort "<clinical question>"')

    settings = load_settings()
    client = anthropic.Anthropic()

    runner = client.beta.messages.tool_runner(
        model=settings.model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[search_omop_concept, define_cohort],
        messages=[{"role": "user", "content": question}],
        max_iterations=MAX_ITERATIONS,
    )

    cohort_json: str | None = None
    for message in runner:
        for block in message.content:
            if block.type == "text" and block.text.strip():
                print(f"[claude] {block.text.strip()}", file=sys.stderr)
            elif block.type == "tool_use":
                print(f"[tool] {block.name}({json.dumps(block.input)[:200]})", file=sys.stderr)
                cohort_json = extract_cohort_result(block) or cohort_json
        if cohort_json is not None:
            break

    if cohort_json is None:
        raise SystemExit(
            f"Claude did not produce a valid cohort definition within {MAX_ITERATIONS} iterations."
        )

    print(cohort_json)


if __name__ == "__main__":
    main()
