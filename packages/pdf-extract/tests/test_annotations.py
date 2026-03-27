"""Tests for annotation extraction."""
from __future__ import annotations

from typing import TYPE_CHECKING

from pdf_extract.phases.annotations import extract_annotations

if TYPE_CHECKING:
    from pathlib import Path


class TestExtractAnnotations:
    """Test annotation extraction from PDFs."""

    def test_annotated_pdf_finds_annotations(self, annotated_pdf: Path) -> None:
        """Annotated PDF produces non-empty markdown with annotations."""
        markdown, count = extract_annotations(str(annotated_pdf))
        assert count > 0
        assert len(markdown) > 0

    def test_annotated_pdf_has_sticky_note(self, annotated_pdf: Path) -> None:
        """Sticky note content appears in output."""
        markdown, _ = extract_annotations(str(annotated_pdf))
        assert "sticky note" in markdown.lower() or "[Note]" in markdown

    def test_annotated_pdf_has_highlight(self, annotated_pdf: Path) -> None:
        """Highlight annotation appears in output."""
        markdown, _ = extract_annotations(str(annotated_pdf))
        assert "[Highlight]" in markdown

    def test_digital_pdf_no_annotations(self, digital_pdf: tuple[Path, list[str]]) -> None:
        """Digital PDF without annotations returns empty."""
        path, _ = digital_pdf
        markdown, count = extract_annotations(str(path))
        assert count == 0
        assert markdown == ""

    def test_returns_tuple(self, annotated_pdf: Path) -> None:
        """Return type is (str, int)."""
        result = extract_annotations(str(annotated_pdf))
        assert isinstance(result, tuple)
        assert isinstance(result[0], str)
        assert isinstance(result[1], int)

    def test_page_comments_present(self, annotated_pdf: Path) -> None:
        """Output contains page markers."""
        markdown, count = extract_annotations(str(annotated_pdf))
        if count > 0:
            assert "Page" in markdown
