"""Main pipeline orchestrator: connects all 7 phases."""
from __future__ import annotations

import time
from pathlib import Path
from typing import TYPE_CHECKING

from pdf_extract.lib import get_logger
from pdf_extract.lib.claude import ClaudeClient
from pdf_extract.lib.gemini import GeminiClient
from pdf_extract.lib.openai_client import OpenAIClient
from pdf_extract.metrics import PhaseMetrics, PipelineMetrics

if TYPE_CHECKING:
    from pdf_extract.config import PipelineConfig

log = get_logger("pipeline")


def _init_clients(
    config: PipelineConfig,
    metrics: PipelineMetrics,
) -> dict[str, GeminiClient | ClaudeClient | OpenAIClient]:
    """Initialize all LLM clients from config. Only creates clients whose keys are available."""
    clients: dict[str, GeminiClient | ClaudeClient | OpenAIClient] = {}

    # Gemini Flash — used by anchored verification, image classification, handwriting detection
    try:
        google_key = config.resolve_api_key("gemini")
        clients["gemini_flash"] = GeminiClient(
            api_key=google_key,
            model=config.anchored_model,
            metrics=metrics,
        )
        # Gemini Pro — used by handwriting extraction
        clients["gemini_pro"] = GeminiClient(
            api_key=google_key,
            model=config.handwriting_extract_model,
            metrics=metrics,
        )
    except ValueError:
        log.warning("gemini.no_api_key", msg="Gemini clients not initialized — GOOGLE_API_KEY missing")

    # Claude Sonnet — used by MEDIUM escalation
    try:
        anthropic_key = config.resolve_api_key("claude")
        clients["claude_sonnet"] = ClaudeClient(
            api_key=anthropic_key,
            model=config.medium_model,
            metrics=metrics,
        )
        # Claude Opus — used by unresolved escalation
        clients["claude_opus"] = ClaudeClient(
            api_key=anthropic_key,
            model=config.unresolved_model,
            metrics=metrics,
        )
    except ValueError:
        log.warning("claude.no_api_key", msg="Claude clients not initialized — ANTHROPIC_API_KEY missing")

    # GPT-4o — used by LOW escalation
    try:
        openai_key = config.resolve_api_key("openai")
        clients["openai"] = OpenAIClient(
            api_key=openai_key,
            model="gpt-4o",
            metrics=metrics,
        )
    except ValueError:
        log.warning("openai.no_api_key", msg="OpenAI client not initialized — OPENAI_API_KEY missing")

    return clients


async def extract_pdf(pdf_path: str, config: PipelineConfig) -> tuple[str, PipelineMetrics]:
    """Main pipeline entry point. Returns (markdown, metrics)."""
    metrics = PipelineMetrics(pdf_path=pdf_path)
    start = time.monotonic()

    config.output_dir.mkdir(parents=True, exist_ok=True)

    # Initialize LLM clients
    clients = _init_clients(config, metrics)

    # Phase 1: Extraction
    from pdf_extract.phases.extract import run_extraction

    phase = PhaseMetrics(name="extraction")
    phase.start()
    markdown, images, tables = await run_extraction(pdf_path, config, metrics)
    phase.stop()
    metrics.phases.append(phase)
    metrics.images_processed = len(images)
    log.info("phase.complete", phase="extraction", duration_ms=phase.duration_ms, images=len(images))

    # Phase 2: Conditional preprocessing (re-extract failed pages)
    if config.preprocess_mode != "never":
        from pdf_extract.phases.preprocess import run_preprocessing

        phase = PhaseMetrics(name="preprocessing")
        phase.start()
        markdown, images, preprocess_pages = await run_preprocessing(
            pdf_path, markdown, images, config, metrics,
        )
        phase.stop()
        metrics.phases.append(phase)
        metrics.degraded_pages = preprocess_pages
        log.info("phase.complete", phase="preprocessing", degraded_pages=len(preprocess_pages))

    # Phase 3: Annotations
    from pdf_extract.phases.annotations import extract_annotations

    phase = PhaseMetrics(name="annotations")
    phase.start()
    annotations_md, annotation_count = extract_annotations(pdf_path)
    phase.stop()
    metrics.phases.append(phase)
    metrics.annotations_found = annotation_count
    log.info("phase.complete", phase="annotations", found=annotation_count)

    # Phase 4: Handwriting
    handwriting: dict[int, str] = {}
    if config.handwriting_enabled:
        gemini_flash = clients.get("gemini_flash")
        gemini_pro = clients.get("gemini_pro")
        if gemini_flash and gemini_pro:
            from pdf_extract.phases.handwriting import detect_and_extract_handwriting

            phase = PhaseMetrics(name="handwriting")
            phase.start()
            handwriting = await detect_and_extract_handwriting(
                pdf_path, config, metrics, gemini_flash, gemini_pro,
            )
            phase.stop()
            metrics.phases.append(phase)
            metrics.handwriting_pages = list(handwriting.keys())
            log.info("phase.complete", phase="handwriting", pages_found=len(handwriting))
        else:
            log.warning("handwriting.skipped", reason="Gemini clients not available")

    # Phase 5: Image understanding
    image_replacements: dict[str, str] = {}
    if images:
        gemini_flash = clients.get("gemini_flash")
        if gemini_flash:
            from pdf_extract.phases.images import process_images

            phase = PhaseMetrics(name="images")
            phase.start()
            image_replacements = await process_images(
                images, config, metrics, gemini_flash,
            )
            phase.stop()
            metrics.phases.append(phase)
            log.info("phase.complete", phase="images", processed=len(image_replacements))
        else:
            log.warning("images.skipped", reason="Gemini client not available")

    # Phase 6: Verification stack
    if config.verify_enabled:
        from pdf_extract.verify.stack import run_verification_stack

        phase = PhaseMetrics(name="verification")
        phase.start()
        markdown = await run_verification_stack(
            pdf_path, markdown, tables, config, metrics, clients,
        )
        phase.stop()
        metrics.phases.append(phase)
        log.info(
            "phase.complete",
            phase="verification",
            proposed=metrics.verification.corrections_proposed,
            applied=metrics.verification.corrections_accepted,
        )

    # Phase 7: Assemble
    from pdf_extract.report import assemble, generate_quality_report

    final_md = assemble(markdown, image_replacements, handwriting, annotations_md)

    metrics.total_pages = markdown.count("\n---\n") + 1
    metrics.total_duration_ms = (time.monotonic() - start) * 1000
    metrics.api.estimate_cost()
    log.info("pipeline.complete", duration_ms=metrics.total_duration_ms, pages=metrics.total_pages)

    # Append quality report
    quality_report = generate_quality_report(metrics)
    final_md = f"{final_md}\n\n{quality_report}"

    # Write output
    out_path = config.output_dir / f"{Path(pdf_path).stem}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(final_md)

    # Write metrics JSON if configured
    if config.metrics_file:
        metrics.write(config.metrics_file)

    return final_md, metrics
