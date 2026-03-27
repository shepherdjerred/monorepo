"""Verification stack orchestrator — runs all layers in sequence."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pdf_extract.lib import get_logger
from pdf_extract.metrics import PhaseMetrics, PipelineMetrics
from pdf_extract.verify.anchored import verify_pages_anchored
from pdf_extract.verify.domain import domain_validate, validate_correction
from pdf_extract.verify.escalation import tiered_escalation
from pdf_extract.verify.tables import verify_tables

if TYPE_CHECKING:
    from pdf_extract.config import PipelineConfig

log = get_logger("verify.stack")


def _apply_verified_corrections(
    markdown: str,
    page_corrections: list[dict[str, object]],
    config: PipelineConfig,
    metrics: PipelineMetrics,
) -> str:
    """Apply corrections from anchored verification, gated by domain validators."""
    result = markdown
    for correction in page_corrections:
        original = str(correction.get("original", ""))
        corrected = str(correction.get("corrected", ""))

        if not original or not corrected:
            continue

        if validate_correction(original, corrected, config):
            if original in result:
                result = result.replace(original, corrected, 1)
                metrics.verification.corrections_accepted += 1
            else:
                log.debug("correction.not_found", original=original)
        else:
            # Determine which rejection reason
            ratio = len(corrected) / max(len(original), 1)
            if ratio < 0.3 or ratio > 3.0:
                metrics.verification.corrections_rejected_length += 1
            else:
                metrics.verification.corrections_rejected_confusion += 1

    return result


async def run_verification_stack(
    pdf_path: str,
    markdown: str,
    tables_info: list[dict[str, object]],
    config: PipelineConfig,
    metrics: PipelineMetrics,
    clients: dict[str, Any] | None = None,
) -> str:
    """Run the full verification stack and return corrected markdown.

    Args:
        clients: Pre-built LLM client dict from pipeline. Keys:
                 "gemini_flash", "gemini_pro", "claude_sonnet", "claude_opus", "openai".
                 Falls back to creating clients from config if not provided.

    Pipeline:
        1. Anchored Gemini verification (all pages)
        2. Cell-by-cell table verification
        3. Domain validation (regex, free)
        4. Tiered multi-model escalation (MEDIUM/LOW/UNRESOLVED)
    """
    if not config.verify_enabled:
        log.info("verification.disabled")
        return markdown

    if clients is None:
        clients = {}

    phase = PhaseMetrics(name="verification")
    phase.start()

    result = markdown

    # Layer 1: Anchored verification
    log.info("verification.layer1_anchored")
    gemini_flash = clients.get("gemini_flash")
    anchored_results = await verify_pages_anchored(
        pdf_path, result, config, metrics, client=gemini_flash,
    )

    # Apply corrections from anchored verification (gated by domain validators)
    for _page_idx, page_result in anchored_results:
        corrections = page_result.get("corrections", [])
        if isinstance(corrections, list) and corrections:
            result = _apply_verified_corrections(result, corrections, config, metrics)

    # Layer 2: Table verification
    if tables_info and config.table_cell_verification:
        log.info("verification.layer2_tables", table_count=len(tables_info))
        result = await verify_tables(
            pdf_path, result, tables_info, config, metrics, client=gemini_flash,
        )

    # Layer 3: Domain validation
    log.info("verification.layer3_domain")
    domain_warnings = domain_validate(result, config)
    metrics.verification.domain_warnings += len(domain_warnings)
    for warning in domain_warnings:
        log.info("domain.warning", **warning)

    # Layer 4: Tiered escalation for uncertain pages
    log.info("verification.layer4_escalation")

    # Escalate MEDIUM pages first
    for page_idx in list(metrics.verification.medium_confidence_pages):
        corrected = await tiered_escalation(
            pdf_path, page_idx, result, "MEDIUM", config, metrics, clients=clients,
        )
        if corrected is not None:
            result = corrected

    # Escalate LOW pages with dual-model consensus
    for page_idx in list(metrics.verification.low_confidence_pages):
        corrected = await tiered_escalation(
            pdf_path, page_idx, result, "LOW", config, metrics, clients=clients,
        )
        if corrected is not None:
            result = corrected
        else:
            # LOW with no consensus -> escalate to UNRESOLVED (Opus)
            corrected = await tiered_escalation(
                pdf_path, page_idx, result, "UNRESOLVED", config, metrics, clients=clients,
            )
            if corrected is not None:
                result = corrected

    phase.stop()
    phase.items_processed = len(anchored_results)
    metrics.phases.append(phase)

    log.info(
        "verification.complete",
        duration_ms=round(phase.duration_ms, 1),
        corrections_accepted=metrics.verification.corrections_accepted,
        corrections_proposed=metrics.verification.corrections_proposed,
        escalated=metrics.verification.escalated_pages,
        opus_reviews=metrics.verification.opus_reviews,
        domain_warnings=metrics.verification.domain_warnings,
    )

    return result
