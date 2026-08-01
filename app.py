"""Browser demo of the same pipeline as main.py's CLI loop:

    pip install -e ".[web]"
    streamlit run app.py

Type a clinical question, and see the cohort definition JSON Claude builds
(nl_to_cohort), the result of actually running it against a real Atlas
WebAPI CDM data source (atlas.py), and a narrative summary of those results
(summarize.py).
"""

import json

import anthropic
import streamlit as st

from nsclc_rwe.atlas import AtlasClient
from nsclc_rwe.cohort import define_cohort
from nsclc_rwe.config import load_settings
from nsclc_rwe.nl_to_cohort import MAX_ITERATIONS, SYSTEM_PROMPT, extract_cohort_result
from nsclc_rwe.summarize import summarize_cohort_results
from nsclc_rwe.tools import search_omop_concept

ATLAS_SOURCE_KEY = "SYNPUF5PCT"

st.set_page_config(page_title="NSCLC RWE Prototype", page_icon=":lungs:")


@st.cache_resource
def get_clients():
    settings = load_settings()
    return settings, anthropic.Anthropic(), AtlasClient(settings)


def build_cohort_definition(question: str, client: anthropic.Anthropic, settings, log) -> dict | None:
    """Run nl_to_cohort's search_omop_concept/define_cohort tool loop, writing
    progress to `log` (an st.status container). Returns the parsed cohort
    definition, or None if Claude never converged within MAX_ITERATIONS."""
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
                log.write(block.text.strip())
            elif block.type == "tool_use":
                log.write(f"`{block.name}({json.dumps(block.input)[:150]})`")
                result = extract_cohort_result(block)
                if result is not None:
                    return json.loads(result)
    return None


st.title("NSCLC RWE Prototype")
st.caption(f"Question → cohort definition → real Atlas query ({ATLAS_SOURCE_KEY}) → narrative summary")

settings, client, atlas = get_clients()

question = st.text_input(
    "Clinical question",
    placeholder="Patients with malignant tumor of lung treated with erlotinib",
)
run = st.button("Run", type="primary", disabled=not question)

if run:
    with st.status("Building cohort definition...", expanded=True) as status:
        cohort_json = build_cohort_definition(question, client, settings, status)
        if cohort_json is None:
            status.update(label="Failed to converge", state="error")
            st.error(f"Claude did not produce a valid cohort definition within {MAX_ITERATIONS} iterations.")
            st.stop()
        status.update(label="Cohort definition built", state="complete")

    st.subheader("Generated cohort definition JSON")
    st.json(cohort_json)

    st.subheader(f"Atlas query ({ATLAS_SOURCE_KEY})")
    cohort_id = None
    try:
        with st.spinner("Creating and generating cohort on Atlas..."):
            cohort_id = atlas.create_cohort_definition(cohort_json.get("name") or question, cohort_json)
            atlas.generate_cohort(cohort_id, ATLAS_SOURCE_KEY)
            person_count = atlas.get_cohort_count(cohort_id, ATLAS_SOURCE_KEY)
            report = atlas.get_cohort_report(cohort_id, ATLAS_SOURCE_KEY)

        col1, col2, col3 = st.columns(3)
        col1.metric("Base population", report["summary"]["baseCount"])
        col2.metric("Final cohort", person_count)
        col3.metric("% matched", report["summary"]["percentMatched"])
        st.json(report)

        st.subheader("Narrative summary")
        cohort_result = {
            "name": cohort_json.get("name") or question,
            "source_key": ATLAS_SOURCE_KEY,
            "person_count": person_count,
            "report": report,
        }
        with st.spinner("Writing summary..."):
            st.write(summarize_cohort_results(cohort_result, client=client))
    except Exception as e:
        st.error(f"Atlas query failed: {e}")
    finally:
        if cohort_id is not None:
            atlas.delete_cohort_definition(cohort_id)
