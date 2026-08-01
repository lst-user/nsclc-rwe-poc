import sys

import anthropic

from .cohort import define_cohort
from .config import load_settings
from .tools import query_omop_database, search_atlas_vocabulary, search_omop_concept


def main() -> None:
    settings = load_settings()
    client = anthropic.Anthropic()

    prompt = " ".join(sys.argv[1:]) or (
        "Introduce yourself, then check whether the OMOP database and the "
        "OHDSI Atlas vocabulary service are reachable."
    )

    runner = client.beta.messages.tool_runner(
        model=settings.model,
        max_tokens=4096,
        thinking={"type": "adaptive"},
        tools=[query_omop_database, search_atlas_vocabulary, search_omop_concept, define_cohort],
        messages=[{"role": "user", "content": prompt}],
    )

    for message in runner:
        for block in message.content:
            if block.type == "text":
                print(block.text)


if __name__ == "__main__":
    main()
