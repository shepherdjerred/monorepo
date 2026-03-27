"""Layer 1: Anchored Gemini verification — compare extraction against page screenshots."""
from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

import fitz

from pdf_extract.lib import get_logger
from pdf_extract.lib.gemini import GeminiClient
from pdf_extract.lib.pdf import render_page
from pdf_extract.lib.prompts import ANCHORED_VERIFY

if TYPE_CHECKING:
    from pdf_extract.config import PipelineConfig
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("verify.anchored")


async def _verify_one_page(
    doc: fitz.Document,
    page_idx: int,
    page_md: str,
    client: GeminiClient,
) -> tuple[int, dict[str, object]]:
    """Verify a single page's extraction against its screenshot."""
    page_img = render_page(doc, page_idx, dpi=200)

    prompt = ANCHORED_VERIFY + f"\n\n## Extracted text:\n{page_md}"

    raw = await client.generate(prompt, image_bytes=page_img)

    # Strip markdown code fences if present
    cleaned = raw.strip().removeprefix("```json").removesuffix("```").strip()
    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError:
        log.warning(
            "anchored.parse_error",
            page=page_idx,
            raw_length=len(raw),
        )
        result = {
            "confidence": "LOW",
            "corrections": [],
            "missing": [],
            "unreadable_regions": [],
            "notes": f"Failed to parse VLM response ({len(raw)} chars)",
        }

    return page_idx, result


def _split_markdown_by_page(markdown: str, total_pages: int) -> list[str]:
    """Split concatenated markdown into per-page chunks.

    Looks for page break markers (--- or <!-- page N -->). Falls back to
    splitting evenly by line count.
    """
    import re

    page_pattern = re.compile(r"<!--\s*page\s+(\d+)\s*-->", re.IGNORECASE)
    parts: list[str] = []

    # Try splitting on <!-- page N --> markers
    splits = page_pattern.split(markdown)
    if len(splits) > 1:
        # splits: [before_first, page_num, content, page_num, content, ...]
        for i in range(2, len(splits), 2):
            parts.append(splits[i].strip())
        # If we got the right number, use them
        if len(parts) == total_pages:
            return parts

    # Fallback: split on horizontal rules
    hr_parts = re.split(r"\n---+\n", markdown)
    if len(hr_parts) == total_pages:
        return [p.strip() for p in hr_parts]

    # Last resort: split evenly by lines
    lines = markdown.splitlines()
    chunk_size = max(1, len(lines) // total_pages)
    result: list[str] = []
    for i in range(total_pages):
        start = i * chunk_size
        end = start + chunk_size if i < total_pages - 1 else len(lines)
        result.append("\n".join(lines[start:end]).strip())
    return result


async def verify_pages_anchored(
    pdf_path: str,
    markdown: str,
    config: PipelineConfig,
    metrics: PipelineMetrics,
    client: GeminiClient | None = None,
) -> list[tuple[int, dict[str, object]]]:
    """Verify all pages using anchored Gemini verification.

    Args:
        client: Pre-built GeminiClient. Falls back to creating one from config.

    Returns list of (page_idx, result_dict) sorted by page index.
    Each result_dict has: confidence, corrections, missing, unreadable_regions.
    """
    doc = fitz.open(pdf_path)
    total_pages = len(doc)

    page_chunks = _split_markdown_by_page(markdown, total_pages)

    if client is None:
        client = GeminiClient(
            api_key=config.resolve_api_key("gemini"),
            model=config.anchored_model,
            metrics=metrics,
        )

    # Verify all pages concurrently
    page_indices = list(range(total_pages))

    tasks = [
        _verify_one_page(doc, idx, page_chunks[idx], client)
        for idx in page_indices
        if idx < len(page_chunks)
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    verified: list[tuple[int, dict[str, object]]] = []
    for result in results:
        if isinstance(result, BaseException):
            log.error("anchored.page_failed", error=str(result))
            metrics.verification.unreadable_regions += 1
            continue
        if not isinstance(result, tuple):
            continue
        page_idx, data = result
        verified.append((page_idx, data))

        # Track confidence tiers
        confidence = str(data.get("confidence", "")).upper()
        if confidence == "LOW":
            metrics.verification.low_confidence_pages.append(page_idx)
        elif confidence == "MEDIUM":
            metrics.verification.medium_confidence_pages.append(page_idx)

        # Track unreadable regions
        unreadable = data.get("unreadable_regions", [])
        if isinstance(unreadable, list):
            metrics.verification.unreadable_regions += len(unreadable)

        # Track proposed corrections
        corrections = data.get("corrections", [])
        if isinstance(corrections, list):
            metrics.verification.corrections_proposed += len(corrections)

    doc.close()
    verified.sort(key=lambda x: x[0])

    log.info(
        "anchored.complete",
        pages_verified=len(verified),
        low_confidence=len(metrics.verification.low_confidence_pages),
        medium_confidence=len(metrics.verification.medium_confidence_pages),
        corrections_proposed=metrics.verification.corrections_proposed,
    )
    return verified
