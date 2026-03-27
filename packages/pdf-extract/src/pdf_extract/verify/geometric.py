"""Geometric Risk Controller — consensus via multiple geometric views of a region."""
from __future__ import annotations

import asyncio
import io
import unicodedata
from collections import Counter
from typing import TYPE_CHECKING

from pdf_extract.lib import get_logger
from pdf_extract.lib.pdf import crop_region
from pdf_extract.lib.prompts import GRC_READ

if TYPE_CHECKING:
    from pdf_extract.config import PipelineConfig
    from pdf_extract.lib.protocols import VisionExtractor
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("verify.geometric")


def _normalize(text: str) -> str:
    """Normalize text for consensus comparison."""
    return unicodedata.normalize("NFD", text.strip().lower())


def _generate_geometric_views(
    page_img: bytes,
    region_bbox: tuple[float, float, float, float],
    k: int = 5,
) -> list[bytes]:
    """Generate K geometric views of a region: original, translated, cropped, scaled, rotated."""
    from PIL import Image

    views: list[bytes] = []

    # View 0: Original crop
    original = crop_region(page_img, region_bbox)
    views.append(original)

    img = Image.open(io.BytesIO(original))
    w, h = img.size

    if k >= 2:
        # View 1: Slight translation (5% offset)
        x0, y0, x1, y1 = region_bbox
        dx = (x1 - x0) * 0.05
        dy = (y1 - y0) * 0.05
        shifted_bbox = (x0 + dx, y0 + dy, x1 + dx, y1 + dy)
        try:
            views.append(crop_region(page_img, shifted_bbox))
        except Exception:
            views.append(original)

    if k >= 3:
        # View 2: Tighter crop (10% padding removed)
        pad_x = int(w * 0.1)
        pad_y = int(h * 0.1)
        tighter = img.crop((pad_x, pad_y, w - pad_x, h - pad_y))
        buf = io.BytesIO()
        tighter.save(buf, format="PNG")
        views.append(buf.getvalue())

    if k >= 4:
        # View 3: Upscaled 2x
        scaled = img.resize((w * 2, h * 2), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        scaled.save(buf, format="PNG")
        views.append(buf.getvalue())

    if k >= 5:
        # View 4: Slight rotation (2 degrees)
        rotated = img.rotate(-2, expand=True, fillcolor=(255, 255, 255))
        buf = io.BytesIO()
        rotated.save(buf, format="PNG")
        views.append(buf.getvalue())

    return views[:k]


async def geometric_risk_control(
    page_img: bytes,
    region_bbox: tuple[float, float, float, float],
    current_text: str,
    client: VisionExtractor,
    config: PipelineConfig,
    metrics: PipelineMetrics | None = None,
) -> tuple[str, float]:
    """Generate K geometric views, query VLM on each, consensus vote.

    Returns (best_text, confidence_score). If no consensus is reached,
    returns (current_text, 0.0).
    """
    views = _generate_geometric_views(page_img, region_bbox, k=config.grc_num_views)

    # Query VLM on each view concurrently
    tasks = [
        client.generate(GRC_READ, image_bytes=view)
        for view in views
    ]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    # Filter out errors and implausibly long outputs
    results: list[str] = []
    max_len = len(current_text) * 3
    for r in raw_results:
        if isinstance(r, BaseException):
            log.debug("grc.view_error", error=str(r))
            continue
        if isinstance(r, str) and len(r) <= max_len:
            results.append(r)

    if not results:
        log.warning("grc.no_valid_results")
        return current_text, 0.0

    if metrics:
        metrics.verification.grc_invocations += 1

    # Consensus voting on normalized text
    votes = Counter(_normalize(r) for r in results)
    winner_normalized, count = votes.most_common(1)[0]

    if count >= config.grc_consensus_threshold:
        # Return the first un-normalized result matching the winner
        for r in results:
            if _normalize(r) == winner_normalized:
                if metrics:
                    metrics.verification.grc_consensus_achieved += 1
                log.info(
                    "grc.consensus",
                    agreement=count,
                    total=len(results),
                    confidence=count / len(results),
                )
                return r, count / len(results)

    log.info(
        "grc.no_consensus",
        top_votes=count,
        threshold=config.grc_consensus_threshold,
        total=len(results),
    )
    return current_text, 0.0
