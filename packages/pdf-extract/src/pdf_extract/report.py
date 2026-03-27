"""Quality report generation and final markdown assembly."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pdf_extract.metrics import PipelineMetrics


def assemble(
    markdown: str,
    image_replacements: dict[str, str],
    handwriting: dict[int, str],
    annotations_md: str,
) -> str:
    """Assemble final markdown from all pipeline outputs.

    Handles edge cases: empty dicts, blank markdown, missing sections.
    """
    if not markdown:
        markdown = ""

    # Main content with image replacements
    content = markdown
    if image_replacements:
        for filename, replacement in image_replacements.items():
            # Match both relative and images/-prefixed references
            content = content.replace(f"![](images/{filename})", replacement)
            content = content.replace(f"![]({filename})", replacement)
            # Also handle named image references: ![alt](images/filename)
            content = re.sub(
                rf"!\[[^\]]*\]\((?:images/)?{re.escape(filename)}\)",
                replacement,
                content,
            )

    parts: list[str] = [content]

    # Handwriting sections (for pages extracted entirely by VLM)
    if handwriting:
        hw_parts = ["\n## Handwritten Content\n"]
        for page_num in sorted(handwriting.keys()):
            text = handwriting[page_num].strip()
            if text:
                hw_parts.append(f"### Page {page_num + 1}\n\n{text}\n")
        if len(hw_parts) > 1:
            parts.append("\n".join(hw_parts))

    # Inline annotations (already placed near their source text)
    if annotations_md and annotations_md.strip():
        parts.append(f"\n{annotations_md.strip()}")

    return "\n".join(parts)


def generate_quality_report(metrics: PipelineMetrics) -> str:
    """Generate a human-readable quality summary as a markdown comment block.

    Appended to the output so it's invisible in rendered markdown but
    available for inspection.
    """
    lines: list[str] = [
        "<!--",
        "== PDF Extraction Quality Report ==",
        "",
    ]

    # Overview
    lines.append(f"Source: {metrics.pdf_path}")
    lines.append(f"Pages: {metrics.total_pages}")
    lines.append(f"Total duration: {metrics.total_duration_ms:.0f}ms")
    lines.append("")

    # Phase timings
    if metrics.phases:
        lines.append("Phase Timings:")
        for phase in metrics.phases:
            lines.append(f"  {phase.name}: {phase.duration_ms:.0f}ms")
        lines.append("")

    # Content summary
    content_items: list[str] = []
    if metrics.images_processed:
        content_items.append(f"Images: {metrics.images_processed}")
    if metrics.tables_found:
        content_items.append(f"Tables: {metrics.tables_found}")
    if metrics.annotations_found:
        content_items.append(f"Annotations: {metrics.annotations_found}")
    if metrics.handwriting_pages:
        content_items.append(f"Handwriting pages: {sorted(metrics.handwriting_pages)}")
    if metrics.diagrams_found:
        content_items.append(f"Diagrams: {metrics.diagrams_found}")
    if metrics.charts_found:
        content_items.append(f"Charts: {metrics.charts_found}")
    if metrics.degraded_pages:
        content_items.append(f"Degraded pages (preprocessed): {sorted(metrics.degraded_pages)}")
    if content_items:
        lines.append("Content Detected:")
        for item in content_items:
            lines.append(f"  {item}")
        lines.append("")

    # Verification summary
    v = metrics.verification
    if v.corrections_proposed or v.table_cells_verified or v.grc_invocations:
        lines.append("Verification:")
        lines.append(f"  Corrections proposed: {v.corrections_proposed}")
        lines.append(f"  Corrections accepted: {v.corrections_accepted}")
        if v.corrections_rejected_length:
            lines.append(f"  Rejected (length change): {v.corrections_rejected_length}")
        if v.corrections_rejected_confusion:
            lines.append(f"  Rejected (confusion pair): {v.corrections_rejected_confusion}")
        if v.corrections_rejected_consensus:
            lines.append(f"  Rejected (no consensus): {v.corrections_rejected_consensus}")
        if v.table_cells_verified:
            lines.append(f"  Table cells verified: {v.table_cells_verified}")
            lines.append(f"  Table mismatches: {v.table_mismatches}")
        if v.grc_invocations:
            lines.append(f"  GRC invocations: {v.grc_invocations}")
            lines.append(f"  GRC consensus achieved: {v.grc_consensus_achieved}")
        if v.domain_warnings:
            lines.append(f"  Domain validation warnings: {v.domain_warnings}")
        if v.unreadable_regions:
            lines.append(f"  Unreadable regions: {v.unreadable_regions}")
        if v.escalated_pages:
            lines.append(f"  Escalated pages: {v.escalated_pages}")
        if v.opus_reviews:
            lines.append(f"  Opus reviews: {v.opus_reviews}")
        lines.append("")

    # Confidence
    if v.low_confidence_pages or v.medium_confidence_pages:
        lines.append("Confidence:")
        if v.medium_confidence_pages:
            lines.append(f"  Medium confidence pages: {sorted(v.medium_confidence_pages)}")
        if v.low_confidence_pages:
            lines.append(f"  Low confidence pages: {sorted(v.low_confidence_pages)}")
        lines.append("")

    # API usage and cost
    api = metrics.api
    total_calls = (
        api.gemini_calls + api.gemini_pro_calls
        + api.claude_sonnet_calls + api.claude_opus_calls
        + api.gpt4o_calls
    )
    if total_calls:
        lines.append("API Usage:")
        if api.gemini_calls:
            tok = api.gemini_input_tokens + api.gemini_output_tokens
            lines.append(f"  Gemini Flash: {api.gemini_calls} calls, {tok} tokens")
        if api.gemini_pro_calls:
            tok = api.gemini_pro_input_tokens + api.gemini_pro_output_tokens
            lines.append(f"  Gemini Pro: {api.gemini_pro_calls} calls, {tok} tokens")
        if api.claude_sonnet_calls:
            tok = api.claude_sonnet_input_tokens + api.claude_sonnet_output_tokens
            lines.append(f"  Claude Sonnet: {api.claude_sonnet_calls} calls, {tok} tokens")
        if api.claude_opus_calls:
            tok = api.claude_opus_input_tokens + api.claude_opus_output_tokens
            lines.append(f"  Claude Opus: {api.claude_opus_calls} calls, {tok} tokens")
        if api.gpt4o_calls:
            tok = api.gpt4o_input_tokens + api.gpt4o_output_tokens
            lines.append(f"  GPT-4o: {api.gpt4o_calls} calls, {tok} tokens")
        if api.total_errors:
            lines.append(f"  Total API errors: {api.total_errors}")
        lines.append(f"  Estimated cost: ${api.estimated_cost_usd:.4f}")
        lines.append("")

    lines.append("-->")
    return "\n".join(lines)
