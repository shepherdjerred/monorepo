"""Phase 4: Handwriting detection (single multi-image call) and extraction."""
from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING

import fitz

from pdf_extract.lib import get_logger
from pdf_extract.lib.pdf import render_page
from pdf_extract.lib.prompts import HANDWRITING_DETECT, HANDWRITING_EXTRACT

if TYPE_CHECKING:
    from pdf_extract.config import PipelineConfig
    from pdf_extract.lib.gemini import GeminiClient
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("phases.handwriting")


async def detect_and_extract_handwriting(
    pdf_path: str,
    config: PipelineConfig,
    metrics: PipelineMetrics,
    detect_client: GeminiClient,
    extract_client: GeminiClient,
) -> dict[int, str]:
    """Detect and extract handwritten text from a PDF.

    Detection sends ALL pages in ONE multi-image call (Flash model).
    Extraction uses Gemini Pro for each detected page (preserves spatial context).

    Args:
        pdf_path: Path to the PDF.
        config: Pipeline configuration.
        metrics: Pipeline metrics to update.
        detect_client: Gemini Flash client for detection.
        extract_client: Gemini Pro client for extraction.

    Returns:
        Dict mapping page index to extracted text (printed + handwritten).
    """
    if not config.handwriting_enabled:
        log.info("handwriting.skip", reason="disabled")
        return {}

    log.info("handwriting.start", pdf=pdf_path)

    # Render all pages
    with fitz.open(pdf_path) as doc:
        page_count = len(doc)
        page_images: list[tuple[bytes, str]] = []
        for i in range(page_count):
            png_bytes = render_page(doc, i, dpi=200)
            page_images.append((png_bytes, "image/png"))

    # Single multi-image detection call
    handwriting_pages = await _detect_handwriting_pages(detect_client, page_images)

    if not handwriting_pages:
        log.info("handwriting.none_detected")
        return {}

    log.info("handwriting.detected", pages=handwriting_pages)
    metrics.handwriting_pages = list(handwriting_pages)

    # Extract from each detected page using Pro model
    results: dict[int, str] = {}
    for page_idx in handwriting_pages:
        if page_idx < 0 or page_idx >= page_count:
            log.warning("handwriting.page_out_of_range", page_idx=page_idx, total=page_count)
            continue

        image_bytes, mime = page_images[page_idx]
        extracted = await extract_client.generate(
            HANDWRITING_EXTRACT,
            image_bytes=image_bytes,
            image_mime=mime,
        )
        results[page_idx] = extracted
        log.debug("handwriting.extracted", page_idx=page_idx, text_len=len(extracted))

    log.info("handwriting.complete", pages_extracted=len(results))
    return results


async def _detect_handwriting_pages(
    client: GeminiClient,
    page_images: list[tuple[bytes, str]],
) -> list[int]:
    """Send all pages in one call, return list of page indices with handwriting."""
    resp = await client.generate_multi_image(HANDWRITING_DETECT, page_images)

    try:
        pages = json.loads(resp)
        if isinstance(pages, list):
            return [int(p) for p in pages]
    except (json.JSONDecodeError, ValueError, TypeError):
        log.warning("handwriting.detect_parse_error", response=resp[:200])

    # Try to extract JSON array from response text
    match = re.search(r"\[[\d\s,]*\]", resp)
    if match:
        try:
            return [int(p) for p in json.loads(match.group())]
        except (json.JSONDecodeError, ValueError):
            pass

    log.warning("handwriting.detect_failed", response=resp[:200])
    return []
