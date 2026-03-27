"""End-to-end pipeline tests with mocked backends and LLM clients."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, patch

from pdf_extract.config import PipelineConfig
from pdf_extract.pipeline import extract_pdf

if TYPE_CHECKING:
    from pathlib import Path

    from pdf_extract.metrics import PipelineMetrics


def _make_mock_clients() -> dict[str, AsyncMock]:
    """Create mock LLM clients that return realistic verification responses."""
    high_confidence = json.dumps({
        "confidence": "HIGH",
        "corrections": [],
        "missing": [],
        "unreadable_regions": [],
        "notes": "",
    })

    async def _gemini_generate(
        prompt: str, image_bytes: bytes | None = None, image_mime: str = "image/png"
    ) -> str:
        if "COMPARE the extraction" in prompt or "verifying" in prompt.lower():
            return high_confidence
        if "Classify this image" in prompt:
            return json.dumps({"type": "PHOTO", "confidence": 0.95})
        if "Describe this image" in prompt:
            return "A photograph showing test content."
        if "handwritten" in prompt.lower() and "extract" in prompt.lower():
            return "[Handwritten] Notes in the margin"
        return "mock response"

    async def _gemini_multi(prompt: str, images: list[tuple[bytes, str]]) -> str:
        if "handwriting" in prompt.lower():
            return "[]"
        return "mock multi response"

    mock = AsyncMock()
    mock.generate = AsyncMock(side_effect=_gemini_generate)
    mock.generate_multi_image = AsyncMock(side_effect=_gemini_multi)

    return {
        "gemini_flash": mock,
        "gemini_pro": mock,
        "claude_sonnet": mock,
        "claude_opus": mock,
        "openai": mock,
    }


def _e2e_config(tmp_path: Path, **overrides: Any) -> PipelineConfig:
    """Build an e2e-ready config with sensible defaults."""
    defaults: dict[str, Any] = {
        "output_dir": tmp_path / "output",
        "backend": "docling",
        "verify_enabled": True,
        "handwriting_enabled": True,
        "preprocess_mode": "never",  # Skip preprocessing in e2e (no image PDFs)
        "google_api_key": "test-key",
        "anthropic_api_key": "test-key",
        "openai_api_key": "test-key",
    }
    defaults.update(overrides)
    return PipelineConfig(**defaults)


async def _run_pipeline(
    pdf_path: str,
    config: PipelineConfig,
    markdown: str = "# Test Document\n\nHello world.\n\n---\n\nPage two content.",
    images: list[Path] | None = None,
    tables: list[dict[str, object]] | None = None,
    mock_clients: dict[str, AsyncMock] | None = None,
) -> tuple[str, PipelineMetrics]:
    """Run the pipeline with mocked extraction backend and LLM clients."""
    if images is None:
        images = []
    if tables is None:
        tables = []
    if mock_clients is None:
        mock_clients = _make_mock_clients()

    async def _mock_extraction(
        pdf: str, cfg: Any, metrics: Any
    ) -> tuple[str, list[Path], list[dict[str, object]]]:
        return markdown, images, tables

    with (
        patch("pdf_extract.pipeline._init_clients", return_value=mock_clients),
        patch("pdf_extract.phases.extract.run_extraction", side_effect=_mock_extraction),
    ):
        return await extract_pdf(pdf_path, config)


# --- E2E Tests ---


class TestE2EDigitalPDF:
    """Test full pipeline on a simple digital PDF."""

    async def test_produces_markdown_output(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, expected_texts = digital_pdf
        config = _e2e_config(tmp_path)

        md, _metrics = await _run_pipeline(
            str(pdf_path),
            config,
            markdown="\n\n---\n\n".join(expected_texts),
        )

        assert len(md) > 0
        for text in expected_texts:
            assert text in md

    async def test_metrics_collected(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, expected_texts = digital_pdf
        config = _e2e_config(tmp_path)

        _, metrics = await _run_pipeline(
            str(pdf_path),
            config,
            markdown="\n\n---\n\n".join(expected_texts),
        )

        assert metrics.total_pages >= 1
        assert metrics.total_duration_ms > 0
        assert len(metrics.phases) >= 1  # At least extraction phase

    async def test_output_file_written(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, expected_texts = digital_pdf
        config = _e2e_config(tmp_path)

        await _run_pipeline(
            str(pdf_path),
            config,
            markdown="\n\n---\n\n".join(expected_texts),
        )

        output_files = list((tmp_path / "output").glob("*.md"))
        assert len(output_files) >= 1


class TestE2EAnnotations:
    """Test that annotations are extracted from annotated PDFs."""

    async def test_sticky_note_extracted(
        self, annotated_pdf: Path, tmp_path: Path
    ) -> None:
        config = _e2e_config(tmp_path)

        md, metrics = await _run_pipeline(
            str(annotated_pdf),
            config,
            markdown="# Annotated doc\n\nBase text.",
        )

        assert metrics.annotations_found > 0
        # The sticky note text should appear in the output
        assert "sticky note" in md.lower() or "Note" in md

    async def test_highlight_extracted(
        self, annotated_pdf: Path, tmp_path: Path
    ) -> None:
        config = _e2e_config(tmp_path)

        _md, metrics = await _run_pipeline(
            str(annotated_pdf),
            config,
            markdown="# Annotated doc\n\nBase text.",
        )

        # Should have found at least the highlight annotation
        assert metrics.annotations_found >= 1


class TestE2EHandwriting:
    """Test handwriting detection and extraction flow."""

    async def test_handwriting_detected_and_extracted(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, _ = digital_pdf
        config = _e2e_config(tmp_path, handwriting_enabled=True)

        # Mock handwriting detection to find handwriting on page 0
        clients = _make_mock_clients()
        clients["gemini_flash"].generate_multi_image = AsyncMock(return_value="[0]")
        clients["gemini_pro"].generate = AsyncMock(
            return_value="[Handwritten] Important margin note"
        )

        md, metrics = await _run_pipeline(
            str(pdf_path), config, mock_clients=clients,
        )

        assert len(metrics.handwriting_pages) > 0
        assert "Handwritten Content" in md
        assert "Important margin note" in md

    async def test_no_handwriting_detected(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, _ = digital_pdf
        config = _e2e_config(tmp_path, handwriting_enabled=True)

        # Default mock returns [] for handwriting detection
        md, metrics = await _run_pipeline(str(pdf_path), config)

        assert len(metrics.handwriting_pages) == 0
        assert "Handwritten Content" not in md


class TestE2EImages:
    """Test image classification and processing flow."""

    async def test_image_replaced_in_output(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, _ = digital_pdf
        config = _e2e_config(tmp_path)

        # Create a fake extracted image
        img_dir = tmp_path / "images"
        img_dir.mkdir()
        img_path = img_dir / "figure1.png"
        # Minimal valid PNG (1x1 white pixel)
        img_path.write_bytes(
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01'
            b'\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00'
            b'\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00'
            b'\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        )

        md, metrics = await _run_pipeline(
            str(pdf_path),
            config,
            markdown="# Doc\n\n![](images/figure1.png)\n\nMore text.",
            images=[img_path],
        )

        # The image placeholder should be replaced with description
        assert "![](images/figure1.png)" not in md
        assert metrics.images_processed == 1


class TestE2EFastMode:
    """Test that --fast mode skips verification."""

    async def test_fast_skips_verification(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, expected_texts = digital_pdf
        config = _e2e_config(tmp_path, verify_enabled=False, handwriting_enabled=False)

        _md, metrics = await _run_pipeline(
            str(pdf_path),
            config,
            markdown="\n".join(expected_texts),
        )

        # Should have extraction phase but no verification phase
        phase_names = [p.name for p in metrics.phases]
        assert "extraction" in phase_names
        assert "verification" not in phase_names
        assert metrics.verification.corrections_proposed == 0


class TestE2EMetrics:
    """Test metrics output."""

    async def test_metrics_json_valid(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, expected_texts = digital_pdf
        metrics_path = tmp_path / "metrics.json"
        config = _e2e_config(tmp_path, metrics_file=metrics_path)

        _, metrics = await _run_pipeline(
            str(pdf_path),
            config,
            markdown="\n".join(expected_texts),
        )

        # Verify metrics can be serialized
        json_str = metrics.to_json()
        parsed = json.loads(json_str)
        assert "total_pages" in parsed
        assert "api" in parsed
        assert "verification" in parsed
        assert "phases" in parsed

    async def test_cost_estimate_present(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, _ = digital_pdf
        config = _e2e_config(tmp_path)

        _, metrics = await _run_pipeline(str(pdf_path), config)

        assert metrics.api.estimated_cost_usd >= 0.0


class TestE2EQualityReport:
    """Test quality report generation."""

    async def test_report_appended_to_output(
        self, digital_pdf: tuple[Path, list[str]], tmp_path: Path
    ) -> None:
        pdf_path, expected_texts = digital_pdf
        config = _e2e_config(tmp_path)

        md, _ = await _run_pipeline(
            str(pdf_path),
            config,
            markdown="\n".join(expected_texts),
        )

        # Quality report should be in an HTML comment at the end
        assert "<!--" in md
        assert "Quality Report" in md or "Phase Timings" in md
        assert "-->" in md
