"""Interactive loop tying the whole pipeline together end to end:

    python main.py

Type a clinical question, and for each one see: the cohort definition JSON
Claude builds (nl_to_cohort), the result of actually running it against a
real Atlas WebAPI CDM data source (atlas.py), and a short narrative summary
of those results (summarize.py). Blank line or Ctrl-D to quit.
"""

import json

import anthropic

from nsclc_rwe.atlas import AtlasClient
from nsclc_rwe.cohort import define_cohort
from nsclc_rwe.config import load_settings
from nsclc_rwe.nl_to_cohort import MAX_ITERATIONS, SYSTEM_PROMPT, extract_cohort_result
from nsclc_rwe.summarize import summarize_cohort_results
from nsclc_rwe.tools import search_omop_concept


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
    print(f"Atlas source: {settings.atlas_source_key}\n")

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

        print(f"\n--- Atlas query ({settings.atlas_source_key}) ---")
        try:
            cohort_id = atlas.create_cohort_definition(cohort_json.get("name") or question, cohort_json)
            atlas.generate_cohort(cohort_id, settings.atlas_source_key)
            person_count = atlas.get_cohort_count(cohort_id, settings.atlas_source_key)
            report = atlas.get_cohort_report(cohort_id, settings.atlas_source_key)
        except Exception as e:  # network/generation failures shouldn't kill the loop
            print(f"Atlas query failed: {e}\n")
            continue

        print(f"Atlas cohort definition id: {cohort_id}")
        print(f"Person count: {person_count}")
        print(f"Report: {json.dumps(report['summary'])}")

        print("\n--- Narrative summary ---")
        cohort_result = {
            "name": cohort_json.get("name") or question,
            "source_key": settings.atlas_source_key,
            "person_count": person_count,
            "report": report,
        }
        print(summarize_cohort_results(cohort_result, client=client))
        print()


if __name__ == "__main__":
    main()
