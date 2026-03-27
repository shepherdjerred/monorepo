"""Layer 4: Tiered multi-model escalation for uncertain pages."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING

import fitz

from pdf_extract.lib import get_logger
from pdf_extract.lib.claude import ClaudeClient
from pdf_extract.lib.openai_client import OpenAIClient
from pdf_extract.lib.pdf import render_page
from pdf_extract.lib.prompts import ESCALATION_VERIFY

if TYPE_CHECKING:
    from pdf_extract.config import PipelineConfig
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("verify.escalation")


def _parse_vlm_response(raw: str) -> dict[str, object]:
    """Parse a VLM verification response, handling markdown fences."""
    cleaned = raw.strip().removeprefix("```json").removesuffix("```").strip()
    try:
        return json.loads(cleaned)  # type: ignore[no-any-return]
    except json.JSONDecodeError:
        return {
            "confidence": "LOW",
            "corrections": [],
            "missing": [],
            "unreadable_regions": [],
        }


def _corrections_match(a: list[dict[str, str]], b: list[dict[str, str]]) -> list[dict[str, str]]:
    """Find corrections where both models agree on original -> corrected mapping."""
    consensus: list[dict[str, str]] = []
    b_set = {(c.get("original", ""), c.get("corrected", "")) for c in b}
    for correction in a:
        key = (correction.get("original", ""), correction.get("corrected", ""))
        if key in b_set:
            consensus.append(correction)
    return consensus


async def tiered_escalation(
    pdf_path: str,
    page_idx: int,
    current_md: str,
    tier: str,
    config: PipelineConfig,
    metrics: PipelineMetrics,
    clients: dict[str, object] | None = None,
) -> str | None:
    """Run tiered escalation for a page.

    Args:
        clients: Pre-built client dict with keys like "claude_sonnet", "claude_opus",
                 "openai". Falls back to creating clients from config if not provided.

    Tiers:
        MEDIUM -> Claude Sonnet second opinion.
        LOW    -> Claude Sonnet + GPT-4o, apply consensus corrections.
        UNRESOLVED -> Opus deep review (full re-extraction + comparison).

    Returns corrected markdown, or None if no corrections were accepted.
    """
    doc = fitz.open(pdf_path)
    page_img = render_page(doc, page_idx, dpi=200)
    doc.close()

    prompt = ESCALATION_VERIFY + f"\n\n## Extracted text:\n{current_md}"

    metrics.verification.escalated_pages += 1

    if clients is None:
        clients = {}

    if tier == "MEDIUM":
        return await _escalate_medium(page_img, prompt, current_md, config, metrics, clients)
    elif tier == "LOW":
        return await _escalate_low(page_img, page_idx, prompt, current_md, config, metrics, clients)
    elif tier == "UNRESOLVED":
        return await _escalate_unresolved(page_img, prompt, current_md, config, metrics, clients)
    else:
        log.warning("escalation.unknown_tier", tier=tier, page=page_idx)
        return None


async def _escalate_medium(
    page_img: bytes,
    prompt: str,
    current_md: str,
    config: PipelineConfig,
    metrics: PipelineMetrics,
    clients: dict[str, object],
) -> str | None:
    """MEDIUM tier: Claude Sonnet second opinion."""
    sonnet = clients.get("claude_sonnet")
    if sonnet is None or not hasattr(sonnet, "generate"):
        sonnet = ClaudeClient(
            api_key=config.resolve_api_key("claude"),
            model=config.medium_model,
            metrics=metrics,
        )

    raw = await sonnet.generate(prompt, image_bytes=page_img)
    result = _parse_vlm_response(raw)

    raw_corrections = result.get("corrections", [])
    corrections = list(raw_corrections) if isinstance(raw_corrections, list) else []
    if not corrections:
        return None

    log.info("escalation.medium", corrections=len(corrections))
    return _apply_corrections(current_md, corrections)


async def _escalate_low(
    page_img: bytes,
    page_idx: int,
    prompt: str,
    current_md: str,
    config: PipelineConfig,
    metrics: PipelineMetrics,
    clients: dict[str, object],
) -> str | None:
    """LOW tier: Claude Sonnet + GPT-4o, apply only consensus corrections."""
    import asyncio

    sonnet = clients.get("claude_sonnet")
    if sonnet is None or not hasattr(sonnet, "generate"):
        sonnet = ClaudeClient(
            api_key=config.resolve_api_key("claude"),
            model=config.medium_model,
            metrics=metrics,
        )

    gpt = clients.get("openai")
    if gpt is None or not hasattr(gpt, "generate"):
        openai_model = "gpt-5.4"
        for m in config.low_models:
            if "gpt" in m.lower():
                openai_model = m
                break
        gpt = OpenAIClient(
            api_key=config.resolve_api_key("openai"),
            model=openai_model,
            metrics=metrics,
        )

    # Run both models concurrently
    sonnet_raw, gpt_raw = await asyncio.gather(
        sonnet.generate(prompt, image_bytes=page_img),
        gpt.generate(prompt, image_bytes=page_img),
    )

    sonnet_result = _parse_vlm_response(sonnet_raw)
    gpt_result = _parse_vlm_response(gpt_raw)

    sonnet_corrections: list[dict[str, str]] = sonnet_result.get("corrections", [])  # type: ignore[assignment]
    gpt_corrections: list[dict[str, str]] = gpt_result.get("corrections", [])  # type: ignore[assignment]

    # Only apply corrections where both models agree
    consensus = _corrections_match(sonnet_corrections, gpt_corrections)

    if not consensus:
        log.info(
            "escalation.low_no_consensus",
            page=page_idx,
            sonnet_corrections=len(sonnet_corrections),
            gpt_corrections=len(gpt_corrections),
        )
        metrics.verification.corrections_rejected_consensus += len(sonnet_corrections)
        return None

    log.info(
        "escalation.low_consensus",
        page=page_idx,
        consensus=len(consensus),
        sonnet_total=len(sonnet_corrections),
        gpt_total=len(gpt_corrections),
    )
    return _apply_corrections(current_md, consensus)


async def _escalate_unresolved(
    page_img: bytes,
    prompt: str,
    current_md: str,
    config: PipelineConfig,
    metrics: PipelineMetrics,
    clients: dict[str, object],
) -> str | None:
    """UNRESOLVED tier: Opus deep review."""
    if metrics.verification.opus_reviews >= config.max_opus_calls:
        log.warning("escalation.opus_budget_exhausted", max=config.max_opus_calls)
        return None

    opus = clients.get("claude_opus")
    if opus is None or not hasattr(opus, "generate"):
        opus = ClaudeClient(
            api_key=config.resolve_api_key("claude"),
            model=config.unresolved_model,
            metrics=metrics,
        )

    metrics.verification.opus_reviews += 1

    raw = await opus.generate(prompt, image_bytes=page_img)
    result = _parse_vlm_response(raw)

    raw_corrections = result.get("corrections", [])
    corrections = list(raw_corrections) if isinstance(raw_corrections, list) else []
    if not corrections:
        return None

    log.info("escalation.opus", corrections=len(corrections))
    return _apply_corrections(current_md, corrections)


def _apply_corrections(
    markdown: str, corrections: list[dict[str, str]]
) -> str:
    """Apply a list of corrections to the markdown text."""
    result = markdown
    for correction in corrections:
        original = correction.get("original", "")
        corrected = correction.get("corrected", "")
        if original and corrected and original in result:
            result = result.replace(original, corrected, 1)
    return result
