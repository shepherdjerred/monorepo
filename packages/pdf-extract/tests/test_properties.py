"""Property-based tests using Hypothesis."""
from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from pdf_extract.lib.mermaid import extract_mermaid_from_text
from pdf_extract.lib.prompts import REFUSAL_SUFFIX
from pdf_extract.report import assemble


class TestAssembleProperties:
    """Property-based tests for final markdown assembly."""

    @given(
        markdown=st.text(min_size=0, max_size=500),
        hw_text=st.text(min_size=1, max_size=200),
        annot_text=st.text(min_size=0, max_size=200),
    )
    @settings(max_examples=50)
    def test_assemble_never_crashes(
        self, markdown: str, hw_text: str, annot_text: str
    ) -> None:
        """assemble() should never raise regardless of input."""
        result = assemble(
            markdown,
            {},
            {0: hw_text},
            annot_text,
        )
        assert isinstance(result, str)

    @given(markdown=st.text(min_size=0, max_size=500))
    @settings(max_examples=50)
    def test_assemble_empty_dicts_returns_markdown(self, markdown: str) -> None:
        """With no replacements/handwriting/annotations, returns original."""
        result = assemble(markdown, {}, {}, "")
        assert markdown in result

    @given(
        markdown=st.text(min_size=10, max_size=200),
    )
    @settings(max_examples=30)
    def test_balanced_code_fences(self, markdown: str) -> None:
        """Output should have balanced triple-backtick fences."""
        result = assemble(markdown, {}, {}, "")
        fence_count = result.count("```")
        assert fence_count % 2 == 0, f"Unbalanced fences: {fence_count}"


class TestMermaidExtractProperties:
    """Property tests for mermaid extraction."""

    @given(code=st.text(min_size=1, max_size=200))
    @settings(max_examples=30)
    def test_roundtrip_mermaid_block(self, code: str) -> None:
        """Wrapping code in a mermaid fence and extracting should return it."""
        if "```" not in code:
            wrapped = f"```mermaid\n{code}\n```"
            extracted = extract_mermaid_from_text(wrapped)
            assert extracted == code.strip()

    @given(text=st.text(min_size=0, max_size=500))
    @settings(max_examples=30)
    def test_extract_never_crashes(self, text: str) -> None:
        """extract_mermaid_from_text should never raise."""
        result = extract_mermaid_from_text(text)
        assert result is None or isinstance(result, str)


class TestPromptProperties:
    """Property tests for prompt constants."""

    def test_refusal_suffix_in_extraction_prompts(self) -> None:
        """All extraction prompts should contain the refusal suffix."""
        from pdf_extract.lib import prompts

        extraction_prompts = [
            prompts.HANDWRITING_EXTRACT,
            prompts.DIAGRAM_EXTRACT,
            prompts.DIAGRAM_VERIFY,
            prompts.CHART_EXTRACT,
            prompts.TABLE_FROM_IMAGE,
            prompts.EQUATION_EXTRACT,
            prompts.ANCHORED_VERIFY,
            prompts.ESCALATION_VERIFY,
            prompts.TIEBREAKER,
        ]
        for prompt in extraction_prompts:
            assert REFUSAL_SUFFIX.strip() in prompt, f"Missing REFUSAL_SUFFIX in: {prompt[:50]}..."
