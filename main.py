"""Interactive loop tying the whole pipeline together end to end:

    python main.py

Type a clinical question, and for each one see: the cohort definition JSON
Claude builds (nl_to_cohort), the result of actually running it against a
real Atlas WebAPI CDM data source (atlas.py), and a short narrative summary
of those results (summarize.py). Blank line or Ctrl-D to quit.

Always queries SYNPUF5PCT (~100x larger than SYNPUF1K, the config default)
regardless of ATLAS_SOURCE_KEY -- this loop is for exploring real questions,
where the bigger sample matters, not the small-sample-size validation checks
SYNPUF1K was used for earlier. Each cohort definition created on Atlas is
deleted again once its results are in hand, so nothing accumulates on the
shared public demo server across runs.
"""

import json

import anthropic

from nsclc_rwe.atlas import AtlasClient
from nsclc_rwe.cohort import define_cohort
from nsclc_rwe.config import load_settings
from nsclc_rwe.nl_to_cohort import MAX_ITERATIONS, SYSTEM_PROMPT, extract_cohort_result
from nsclc_rwe.summarize import summarize_cohort_results
from nsclc_rwe.tools import search_omop_concept

ATLAS_SOURCE_KEY = "SYNPUF5PCT"


def build_cohort_definition(question: str, client: anthropic.Anthropic, settings) -> dict | None:
    """Run nl_to_cohort's search_omop_concept/define_cohort tool loop for one
    question. Returns the parsed cohort definition, or None if Claude never
    converged on a valid one within MAX_ITERATIONS."""
    runner = client.beta.messages.tool_runner(
        model=settings.model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[search_omop_concept, define_cohort],
        messages=[{"role": "user", "content": question}],
        max_iterations=MAX_ITERATIONS,
    )
    for message in runner:
        for block in message.content:
            if block.type == "text" and block.text.strip():
                print(f"  [claude] {block.text.strip()}")
            elif block.type == "tool_use":
                print(f"  [tool] {block.name}({json.dumps(block.input)[:150]})")
                result = extract_cohort_result(block)
                if result is not None:
                    return json.loads(result)
    return None


def main() -> None:
    settings = load_settings()
    client = anthropic.Anthropic()
    atlas = AtlasClient(settings)

    print("NSCLC RWE prototype -- type a clinical question (blank line to quit).")
    print(f"Atlas source: {ATLAS_SOURCE_KEY}\n")

    while True:
        try:
            question = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not question:
            break

        print("\n--- Building cohort definition ---")
        cohort_json = build_cohort_definition(question, client, settings)
        if cohort_json is None:
            print(f"Claude did not produce a valid cohort definition within {MAX_ITERATIONS} iterations.\n")
            continue

        print("\n--- Generated cohort definition JSON ---")
        print(json.dumps(cohort_json, indent=2))

        print(f"\n--- Atlas query ({ATLAS_SOURCE_KEY}) ---")
        try:
            cohort_id = atlas.create_cohort_definition(cohort_json.get("name") or question, cohort_json)
        except Exception as e:  # network/generation failures shouldn't kill the loop
            print(f"Atlas query failed: {e}\n")
            continue

        try:
            atlas.generate_cohort(cohort_id, ATLAS_SOURCE_KEY)
            person_count = atlas.get_cohort_count(cohort_id, ATLAS_SOURCE_KEY)
            report = atlas.get_cohort_report(cohort_id, ATLAS_SOURCE_KEY)

            print(f"Person count: {person_count}")
            if report["inclusionRuleStats"]:
                print(f"Report: {json.dumps(report['summary'])}")
            else:
                # No inclusion rules -> nothing for Atlas's attrition report to
                # compute; it returns baseCount/finalCount 0 even though
                # person_count above is the real, reliable number.
                print("Report: no inclusion rules were applied, so there's no attrition funnel to report.")

            print("\n--- Narrative summary ---")
            cohort_result = {
                "name": cohort_json.get("name") or question,
                "source_key": ATLAS_SOURCE_KEY,
                "person_count": person_count,
                # report's baseCount/finalCount are 0 when there are no inclusion
                # rules (nothing for Atlas's attrition report to compute) -- don't
                # feed that contradiction to summarize_cohort_results alongside
                # the real person_count above.
                "report": report if report["inclusionRuleStats"] else None,
            }
            print(summarize_cohort_results(cohort_result, client=client))
            print()
        except Exception as e:
            print(f"Atlas query failed: {e}\n")
        finally:
            atlas.delete_cohort_definition(cohort_id)


if __name__ == "__main__":
    main()
