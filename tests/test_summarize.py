from types import SimpleNamespace

from nsclc_rwe.summarize import summarize_cohort_results

COHORT_RESULT = {
    "name": "Malignant tumor of lung, treated with erlotinib",
    "source_key": "SYNPUF5PCT",
    "person_count": 3,
    "report": {
        "summary": {"baseCount": 3880, "finalCount": 3, "lostCount": 0, "percentMatched": "0.08%"},
        "inclusionRuleStats": [
            {"name": "Treated with erlotinib on or after diagnosis", "countSatisfying": 3}
        ],
    },
}


class _FakeMessages:
    def __init__(self, text: str):
        self._text = text
        self.captured_kwargs = None

    def create(self, **kwargs):
        self.captured_kwargs = kwargs
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=self._text)])


class _FakeClient:
    def __init__(self, text: str):
        self.messages = _FakeMessages(text)


def test_summarize_cohort_results_returns_claude_text():
    client = _FakeClient("Among 3,880 patients with a lung cancer diagnosis, 3 (0.08%) were treated with erlotinib.")

    result = summarize_cohort_results(COHORT_RESULT, client=client)

    assert result == "Among 3,880 patients with a lung cancer diagnosis, 3 (0.08%) were treated with erlotinib."


def test_summarize_cohort_results_sends_cohort_data_and_system_prompt():
    client = _FakeClient("summary")

    summarize_cohort_results(COHORT_RESULT, client=client)

    kwargs = client.messages.captured_kwargs
    assert "system" in kwargs
    assert "abstract" in kwargs["system"].lower()
    user_content = kwargs["messages"][0]["content"]
    assert "SYNPUF5PCT" in user_content
    assert "3880" in user_content
    assert "erlotinib" in user_content


def test_summarize_cohort_results_strips_whitespace_and_ignores_non_text_blocks():
    client = _FakeClient("  padded text  ")
    client.messages._text = "  padded text  "

    def create(**kwargs):
        return SimpleNamespace(content=[
            SimpleNamespace(type="tool_use", name="unused", input={}),
            SimpleNamespace(type="text", text="  padded text  "),
        ])

    client.messages.create = create

    result = summarize_cohort_results(COHORT_RESULT, client=client)

    assert result == "padded text"
