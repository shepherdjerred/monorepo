"""Phase 1: Extraction — routes to the configured backend."""
from __future__ import annotations

import tempfile
from typing import TYPE_CHECKING

from pdf_extract.lib import get_logger

if TYPE_CHECKING:
    from pathlib import Path

    from pdf_extract.config import PipelineConfig
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("phases.extract")


async def run_extraction(
    pdf_path: str,
    config: PipelineConfig,
    metrics: PipelineMetrics,
) -> tuple[str, list[Path], list[dict[str, object]]]:
    """Run PDF extraction using the configured backend.

    Routes to docling (default) or mineru based on ``config.backend``.

    Returns:
        Tuple of (markdown_text, image_paths, table_info).
    """
    log.info("extraction.start", backend=config.backend, pdf=pdf_path)

    output_dir = tempfile.mkdtemp(prefix="pdf_extract_")

    if config.backend == "mineru":
        from pdf_extract.backends.mineru import extract_with_mineru

        markdown, images, tables = await extract_with_mineru(
            pdf_path, output_dir, config,
        )
    else:
        from pdf_extract.backends.docling import extract_with_docling

        markdown, images, tables = await extract_with_docling(
            pdf_path, output_dir, config,
        )

    metrics.tables_found = len(tables)

    log.info(
        "extraction.complete",
        backend=config.backend,
        markdown_len=len(markdown),
        images=len(images),
        tables=len(tables),
    )

    return markdown, images, tables
