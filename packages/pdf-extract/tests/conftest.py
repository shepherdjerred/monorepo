"""Shared test fixtures for pdf-extract."""
from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

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
