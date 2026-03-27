"""Phase 2: Conditional scan recovery — only preprocess pages that failed extraction."""
from __future__ import annotations

import tempfile
from typing import TYPE_CHECKING

import fitz  # type: ignore[import-untyped]

from pdf_extract.lib import get_logger
from pdf_extract.lib.imaging import check_contrast, denoise, deskew, detect_skew_angle, estimate_dpi, upscale_fsrcnn
from pdf_extract.lib.pdf import render_page

if TYPE_CHECKING:
    from pathlib import Path

    from pdf_extract.config import PipelineConfig
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("phases.preprocess")


async def run_preprocessing(
    pdf_path: str,
    markdown: str,
    images: list[Path],
    config: PipelineConfig,
    metrics: PipelineMetrics,
) -> tuple[str, list[Path], list[int]]:
    """Identify degraded pages and re-extract after preprocessing.

    Returns:
        Tuple of (updated_markdown, updated_images, list_of_preprocessed_page_indices).
    """
    failed_pages = _detect_failed_pages(pdf_path, markdown)
    if not failed_pages:
        log.info("preprocess.skip", reason="no_failed_pages")
        return markdown, images, []

    log.info("preprocess.start", pdf=pdf_path, failed_pages=failed_pages)

    enhanced_path = _preprocess_pages(pdf_path, failed_pages, config)

    # Re-extract the enhanced PDF
    from pdf_extract.phases.extract import run_extraction

    new_markdown, new_images, _tables = await run_extraction(enhanced_path, config, metrics)

    # Merge: replace content for preprocessed pages, keep original for others
    # For simplicity, if preprocessing was triggered, use the new extraction
    log.info("preprocess.complete", pages_processed=len(failed_pages))
    return new_markdown, new_images, failed_pages


def _detect_failed_pages(pdf_path: str, markdown: str) -> list[int]:
    """Detect pages that likely failed extraction (very little text produced).

    Heuristic: pages where extracted text is less than 20 characters are
    considered failed (likely scanned/degraded).
    """
    failed: list[int] = []
    with fitz.open(pdf_path) as doc:
        # Split markdown by page separators if present
        page_texts = markdown.split("\n---\n") if "\n---\n" in markdown else [markdown]

        for i in range(len(doc)):
            page_text = page_texts[i].strip() if i < len(page_texts) else ""
            if len(page_text) < 20:
                failed.append(i)

    if failed:
        log.info("preprocess.failed_pages_detected", pages=failed)
    return failed


def _preprocess_pages(
    pdf_path: str,
    failed_pages: list[int],
    config: PipelineConfig,
) -> str:
    """Preprocess only the pages that failed extraction.

    Processing order: deskew -> denoise -> FSRCNN upscale (if below DPI threshold).
    No binarization — Docling/MinerU handle grayscale well.

    Returns:
        Path to enhanced PDF with processed pages replacing originals.
    """
    log.info("preprocess.enhance", pdf=pdf_path, pages=failed_pages)

    with fitz.open(pdf_path) as doc:
        for page_idx in failed_pages:
            if page_idx >= len(doc):
                log.warning("preprocess.page_out_of_range", page_idx=page_idx, total=len(doc))
                continue
            _process_page(doc, page_idx, config)

        output_path = tempfile.mktemp(prefix="pdf_extract_enhanced_", suffix=".pdf")
        doc.save(output_path)

    log.info("preprocess.enhance.complete", output=output_path)
    return output_path


def _process_page(doc: fitz.Document, page_idx: int, config: PipelineConfig) -> None:
    """Apply deskew, denoise, and optional upscale to a single page."""
    import cv2
    import numpy as np

    log.debug("preprocess.page.start", page_idx=page_idx)

    # Render page to grayscale
    png_bytes = render_page(doc, page_idx, dpi=200)
    img_array = np.frombuffer(png_bytes, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_GRAYSCALE)
    if img is None:
        log.warning("preprocess.page.decode_failed", page_idx=page_idx)
        return

    # Step 1: Deskew
    angle = detect_skew_angle(img)
    if abs(angle) > 0.5:
        log.debug("preprocess.page.deskew", page_idx=page_idx, angle=angle)
        img = deskew(img, angle)

    # Step 2: Denoise
    contrast = check_contrast(img)
    if contrast < config.min_contrast_threshold:
        log.debug("preprocess.page.denoise", page_idx=page_idx, contrast=contrast)
        img = denoise(img)

    # Step 3: Upscale if below DPI threshold
    page = doc[page_idx]
    effective_dpi = estimate_dpi(img.shape[1], page.rect.width)
    if effective_dpi < config.min_dpi_threshold:
        scale = max(2, int(config.min_dpi_threshold / effective_dpi) + 1)
        scale = min(scale, 4)  # Cap at 4x
        log.debug("preprocess.page.upscale", page_idx=page_idx, effective_dpi=effective_dpi, scale=scale)
        img = upscale_fsrcnn(img, scale=scale)

    # Re-encode and replace page
    success, encoded = cv2.imencode(".png", img)
    if not success:
        log.warning("preprocess.page.encode_failed", page_idx=page_idx)
        return

    _replace_page_with_image(doc, page_idx, encoded.tobytes())
    log.debug("preprocess.page.complete", page_idx=page_idx)


def _replace_page_with_image(doc: fitz.Document, page_idx: int, png_bytes: bytes) -> None:
    """Replace a page's content with a preprocessed image."""
    page = doc[page_idx]
    page.clean_contents()

    # Insert the enhanced image covering the full page
    rect = page.rect
    page.insert_image(rect, stream=png_bytes)
