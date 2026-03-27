"""Shared test fixtures for pdf-extract."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, patch

import pytest

from pdf_extract.config import PipelineConfig
from pdf_extract.metrics import PipelineMetrics

if TYPE_CHECKING:
    from pathlib import Path


@pytest.fixture()
def config(tmp_path: Path) -> PipelineConfig:
    """Default pipeline config with tmp output dir."""
    return PipelineConfig(output_dir=tmp_path / "output")


@pytest.fixture()
def metrics() -> PipelineMetrics:
    """Empty pipeline metrics."""
    return PipelineMetrics()


@pytest.fixture()
def mock_gemini() -> AsyncMock:
    """AsyncMock that mimics GeminiClient.generate / generate_multi_image.

    Override return_value or side_effect per test as needed.
    """
    mock = AsyncMock()
    mock.generate = AsyncMock(return_value="mock response")
    mock.generate_multi_image = AsyncMock(return_value="[]")
    return mock


# --- Session-scoped PDF fixtures generated via fpdf2 ---


@pytest.fixture(scope="session")
def digital_pdf(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, list[str]]:
    """2-page digital PDF with known text."""
    from tests.fixtures.generate import generate_simple_text

    path = tmp_path_factory.mktemp("pdfs") / "digital.pdf"
    expected = generate_simple_text(path)
    return path, expected


@pytest.fixture(scope="session")
def table_pdf(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, list[list[str]]]:
    """PDF with a known table."""
    from tests.fixtures.generate import generate_table_pdf

    path = tmp_path_factory.mktemp("pdfs") / "table.pdf"
    expected = generate_table_pdf(path)
    return path, expected


@pytest.fixture(scope="session")
def annotated_pdf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """PDF with highlights and sticky notes."""
    from tests.fixtures.generate import generate_annotated_pdf

    path = tmp_path_factory.mktemp("pdfs") / "annotated.pdf"
    generate_annotated_pdf(path)
    return path


@pytest.fixture(scope="session")
def degraded_pdf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Degraded scan PDF for preprocessing tests."""
    from tests.fixtures.generate import generate_degraded_scan

    path = tmp_path_factory.mktemp("pdfs") / "degraded.pdf"
    generate_degraded_scan(path)
    return path


# --- E2E test fixtures ---


def _make_mock_gemini_client(responses: dict[str, str] | None = None) -> AsyncMock:
    """Create a mock GeminiClient with configurable responses."""
    default_verify = json.dumps({
        "confidence": "HIGH",
        "corrections": [],
        "missing": [],
        "unreadable_regions": [],
        "notes": "",
    })
    defaults = {
        "verify": default_verify,
        "classify": json.dumps({"type": "PHOTO", "confidence": 0.9}),
        "handwriting_detect": "[]",
        "handwriting_extract": "[Handwritten] Test handwritten text",
        "default": "mock response",
    }
    if responses:
        defaults.update(responses)

    async def _generate(prompt: str, image_bytes: bytes | None = None, image_mime: str = "image/png") -> str:
        # Route based on prompt content
        if "COMPARE the extraction" in prompt or "verifying" in prompt.lower():
            return defaults["verify"]
        if "Classify this image" in prompt or "classify" in prompt.lower():
            return defaults["classify"]
        if "handwritten" in prompt.lower() and "extract" in prompt.lower():
            return defaults["handwriting_extract"]
        return defaults["default"]

    async def _generate_multi(prompt: str, images: list[tuple[bytes, str]]) -> str:
        if "handwriting" in prompt.lower() or "handwritten" in prompt.lower():
            return defaults["handwriting_detect"]
        return defaults["default"]

    mock = AsyncMock()
    mock.generate = AsyncMock(side_effect=_generate)
    mock.generate_multi_image = AsyncMock(side_effect=_generate_multi)
    return mock


@pytest.fixture()
def mock_clients() -> dict[str, Any]:
    """Mock LLM clients dict matching what _init_clients returns."""
    return {
        "gemini_flash": _make_mock_gemini_client(),
        "gemini_pro": _make_mock_gemini_client(),
        "claude_sonnet": _make_mock_gemini_client(),  # Same interface
        "claude_opus": _make_mock_gemini_client(),
        "openai": _make_mock_gemini_client(),
    }


@pytest.fixture()
def e2e_config(tmp_path: Path) -> PipelineConfig:
    """Config for e2e tests: verification enabled, handwriting enabled."""
    return PipelineConfig(
        output_dir=tmp_path / "output",
        backend="docling",
        verify_enabled=True,
        handwriting_enabled=True,
        google_api_key="test-key",
        anthropic_api_key="test-key",
        openai_api_key="test-key",
    )


@pytest.fixture()
def patch_pipeline_for_e2e(mock_clients: dict[str, Any]) -> Any:
    """Patch _init_clients and the docling backend for e2e tests.

    Usage:
        with patch_pipeline_for_e2e(markdown="# Hello", images=[], tables=[]):
            result = await extract_pdf(...)
    """

    class _Patcher:
        def __call__(
            self,
            markdown: str = "# Test\n\nHello world.",
            images: list[Any] | None = None,
            tables: list[dict[str, object]] | None = None,
        ) -> Any:
            if images is None:
                images = []
            if tables is None:
                tables = []

            async def _mock_extract(pdf_path: str, config: Any, metrics: Any) -> tuple[str, list[Any], list[Any]]:
                return markdown, images, tables

            return _MultiPatch(mock_clients, _mock_extract)

    class _MultiPatch:
        def __init__(self, clients: dict[str, Any], extract_fn: Any) -> None:
            self._clients = clients
            self._extract_fn = extract_fn
            self._patches: list[Any] = []

        def __enter__(self) -> _MultiPatch:
            p1 = patch("pdf_extract.pipeline._init_clients", return_value=self._clients)
            p2 = patch("pdf_extract.pipeline.run_extraction", self._extract_fn)
            # Also patch the import inside pipeline.py
            p3 = patch("pdf_extract.phases.extract.run_extraction", self._extract_fn)
            self._patches = [p1.__enter__(), p2, p3]
            # We need to patch at the point of import in pipeline.py
            # Since pipeline uses `from pdf_extract.phases.extract import run_extraction`,
            # we need to patch it before it's imported
            return self

        def __exit__(self, *args: Any) -> None:
            for p in self._patches:
                if hasattr(p, "__exit__"):
                    p.__exit__(*args)

    return _Patcher()
