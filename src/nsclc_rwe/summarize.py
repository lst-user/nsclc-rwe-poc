"""Cohort results (counts, attrition stats) -> a Claude-written abstract paragraph.

Takes what's already been retrieved about a generated cohort -- its defining
criteria, the person count, and Atlas's inclusion-rule attrition report (see
AtlasClient.get_cohort_report) -- and asks Claude for a short, abstract-style
summary paragraph, the kind that opens a real-world-evidence study writeup.
"""

import json

import anthropic

from .config import load_settings

SYSTEM_PROMPT = """\
You write a single short abstract-style summary paragraph (3-5 sentences, \
the kind that opens a real-world-evidence cohort study) from cohort results \
data. Ground every sentence in the numbers given: the cohort's defining \
criteria, the data source, the base population size, how attrition through \
each inclusion rule narrowed it down, and the final count. Do not invent \
patient-level details -- demographics, dates, outcomes -- that aren't present \
in the data. If only a count is given, write about the count; don't imply \
richer detail than what was retrieved. Plain prose, no headers or bullet \
points, no preamble like "Here is the summary"."""


def summarize_cohort_results(cohort_result: dict, client: anthropic.Anthropic | None = None) -> str:
    """Ask Claude to write a short abstract-style paragraph from cohort results.

    `cohort_result` is expected to look like:
        {
            "name": str,             # cohort definition name
            "source_key": str,       # Atlas CDM data source, e.g. "SYNPUF5PCT"
            "person_count": int,     # AtlasClient.run_cohort()'s result
            "report": dict | None,   # AtlasClient.get_cohort_report()'s result, if available
        }
    """
    settings = load_settings()
    client = client or anthropic.Anthropic()

    message = client.messages.create(
        model=settings.model,
        max_tokens=400,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": (
                    "Cohort study results:\n\n"
                    f"{json.dumps(cohort_result, indent=2)}\n\n"
                    "Write the abstract-style summary paragraph."
                ),
            }
        ],
    )
    return "".join(block.text for block in message.content if block.type == "text").strip()
