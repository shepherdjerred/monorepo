"""Phase 5: Image understanding — classify and extract structured data from images."""
from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from pdf_extract.lib import get_logger
from pdf_extract.lib.mermaid import extract_mermaid_from_text, validate_mermaid_syntax
from pdf_extract.lib.prompts import (
    CHART_EXTRACT,
    DIAGRAM_EXTRACT,
    EQUATION_EXTRACT,
    IMAGE_CLASSIFY,
    PHOTO_DESCRIBE,
    TABLE_FROM_IMAGE,
)

if TYPE_CHECKING:
    from pathlib import Path

    from pdf_extract.config import PipelineConfig
    from pdf_extract.lib.gemini import GeminiClient
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("phases.images")


async def process_images(
    images: list[Path],
    config: PipelineConfig,
    metrics: PipelineMetrics,
    client: GeminiClient,
) -> dict[str, str]:
    """Classify and extract structured data from all images concurrently.

    Args:
        images: List of image file paths extracted from the PDF.
        config: Pipeline configuration.
        metrics: Pipeline metrics to update.
        client: Gemini client for VLM calls.

    Returns:
        Dict mapping image filename to its extracted markdown representation.
    """
    if not images:
        return {}

    log.info("images.start", count=len(images))

    tasks = [_process_single_image(img, client, config, metrics) for img in images]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    output: dict[str, str] = {}
    for img, result in zip(images, results, strict=True):
        if isinstance(result, BaseException):
            log.error("images.process_error", image=str(img), error=str(result))
            output[img.name] = f"<!-- Image processing failed: {img.name} -->"
        else:
            output[img.name] = str(result)

    metrics.images_processed = len(images)
    log.info("images.complete", count=len(images), successful=len(output))
    return output


async def _process_single_image(
    image_path: Path,
    client: GeminiClient,
    config: PipelineConfig,
    metrics: PipelineMetrics,
) -> str:
    """Classify a single image and route to the appropriate handler."""
    image_bytes = image_path.read_bytes()

    # Classify the image
    classify_resp = await client.generate(IMAGE_CLASSIFY, image_bytes=image_bytes)
    try:
        classification = json.loads(classify_resp)
    except json.JSONDecodeError:
        log.warning("images.classify_parse_error", image=str(image_path), response=classify_resp[:200])
        classification = {"category": "OTHER", "confidence": 0.0}

    category = classification.get("category", "OTHER").upper()
    confidence = classification.get("confidence", 0.0)
    log.debug("images.classified", image=str(image_path), category=category, confidence=confidence)

    if category == "DIAGRAM":
        metrics.diagrams_found += 1
        return await _handle_diagram(image_bytes, client, config)
    if category == "CHART":
        metrics.charts_found += 1
        return await _handle_chart(image_bytes, client)
    if category == "EQUATION":
        return await _handle_equation(image_bytes, client)
    if category == "TABLE":
        metrics.tables_found += 1
        return await _handle_table(image_bytes, client)
    if category == "PHOTO":
        return await _handle_photo(image_bytes, client)
    # OTHER
    return await _handle_photo(image_bytes, client)


async def _handle_diagram(
    image_bytes: bytes,
    client: GeminiClient,
    config: PipelineConfig,
) -> str:
    """Extract diagram as Mermaid code with optional self-correction."""
    resp = await client.generate(DIAGRAM_EXTRACT, image_bytes=image_bytes)

    try:
        data = json.loads(resp)
        mermaid_code = data.get("mermaid", "")
    except json.JSONDecodeError:
        # Try extracting mermaid from fenced block
        mermaid_code = extract_mermaid_from_text(resp) or ""

    if not mermaid_code:
        return f"<!-- Diagram: extraction produced no Mermaid code -->\n\n{resp}"

    # Validate syntax
    if validate_mermaid_syntax(mermaid_code):
        return f"```mermaid\n{mermaid_code}\n```"

    # Retry once on syntax failure
    log.debug("images.diagram.retry", reason="syntax_validation_failed")
    retry_prompt = (
        f"The following Mermaid code has syntax errors. Fix the syntax and return only valid Mermaid code:\n\n"
        f"```mermaid\n{mermaid_code}\n```"
    )
    retry_resp = await client.generate(retry_prompt, image_bytes=image_bytes)
    retried_code = extract_mermaid_from_text(retry_resp) or retry_resp.strip()

    if validate_mermaid_syntax(retried_code):
        return f"```mermaid\n{retried_code}\n```"

    # Self-correction loop for hand-drawn diagrams
    if config.mermaid_self_correct in ("always", "hand_drawn_only"):
        log.debug("images.diagram.self_correct_skipped", reason="retry_also_failed")

    # Return best effort
    return f"```mermaid\n{retried_code}\n```\n\n<!-- Warning: Mermaid syntax may be invalid -->"


async def _handle_chart(image_bytes: bytes, client: GeminiClient) -> str:
    """Extract chart data as a markdown table."""
    result: str = await client.generate(CHART_EXTRACT, image_bytes=image_bytes)
    return result


async def _handle_equation(image_bytes: bytes, client: GeminiClient) -> str:
    """Extract equation as LaTeX."""
    result: str = await client.generate(EQUATION_EXTRACT, image_bytes=image_bytes)
    return result


async def _handle_table(image_bytes: bytes, client: GeminiClient) -> str:
    """Extract table from image as markdown."""
    result: str = await client.generate(TABLE_FROM_IMAGE, image_bytes=image_bytes)
    return result


async def _handle_photo(image_bytes: bytes, client: GeminiClient) -> str:
    """Describe a photograph."""
    result: str = await client.generate(PHOTO_DESCRIBE, image_bytes=image_bytes)
    return result
