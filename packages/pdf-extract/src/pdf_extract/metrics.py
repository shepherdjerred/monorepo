"""Structured metrics collection for pipeline runs."""
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


@dataclass
class PhaseMetrics:
    """Timing and counts for a single pipeline phase."""

    name: str
    started_at: float = 0.0
    ended_at: float = 0.0
    duration_ms: float = 0.0
    items_processed: int = 0
    errors: int = 0
    metadata: dict[str, object] = field(default_factory=dict)

    def start(self) -> None:
        self.started_at = time.monotonic()

    def stop(self) -> None:
        self.ended_at = time.monotonic()
        self.duration_ms = (self.ended_at - self.started_at) * 1000


@dataclass
class APIMetrics:
    """Track API usage and estimated cost per provider."""

    # Gemini Flash
    gemini_calls: int = 0
    gemini_input_tokens: int = 0
    gemini_output_tokens: int = 0
    gemini_errors: int = 0

    # Gemini Pro (handwriting extraction)
    gemini_pro_calls: int = 0
    gemini_pro_input_tokens: int = 0
    gemini_pro_output_tokens: int = 0

    # Claude Sonnet (MEDIUM escalation)
    claude_sonnet_calls: int = 0
    claude_sonnet_input_tokens: int = 0
    claude_sonnet_output_tokens: int = 0
    claude_sonnet_errors: int = 0

    # Claude Opus (unresolved escalation)
    claude_opus_calls: int = 0
    claude_opus_input_tokens: int = 0
    claude_opus_output_tokens: int = 0
    claude_opus_errors: int = 0

    # GPT-4o (LOW escalation)
    gpt4o_calls: int = 0
    gpt4o_input_tokens: int = 0
    gpt4o_output_tokens: int = 0
    gpt4o_errors: int = 0

    total_errors: int = 0
    estimated_cost_usd: float = 0.0

    def estimate_cost(self) -> float:
        """Rough cost estimate based on current pricing (per MTok)."""
        cost = 0.0
        # Gemini 2.5 Flash: $0.30/$2.50
        cost += self.gemini_input_tokens * 0.30 / 1_000_000
        cost += self.gemini_output_tokens * 2.50 / 1_000_000
        # Gemini 2.5 Pro: $1.25/$10.00
        cost += self.gemini_pro_input_tokens * 1.25 / 1_000_000
        cost += self.gemini_pro_output_tokens * 10.00 / 1_000_000
        # Claude Sonnet 4.6: $3.00/$15.00
        cost += self.claude_sonnet_input_tokens * 3.00 / 1_000_000
        cost += self.claude_sonnet_output_tokens * 15.00 / 1_000_000
        # Claude Opus 4.6: $5.00/$25.00
        cost += self.claude_opus_input_tokens * 5.00 / 1_000_000
        cost += self.claude_opus_output_tokens * 25.00 / 1_000_000
        # GPT-4o: $2.50/$10.00
        cost += self.gpt4o_input_tokens * 2.50 / 1_000_000
        cost += self.gpt4o_output_tokens * 10.00 / 1_000_000
        self.estimated_cost_usd = cost
        return cost


@dataclass
class VerificationMetrics:
    """Track verification stack effectiveness."""

    corrections_proposed: int = 0
    corrections_accepted: int = 0
    corrections_rejected_length: int = 0
    corrections_rejected_confusion: int = 0
    corrections_rejected_consensus: int = 0

    table_cells_verified: int = 0
    table_mismatches: int = 0

    grc_invocations: int = 0
    grc_consensus_achieved: int = 0

    domain_warnings: int = 0
    unreadable_regions: int = 0

    low_confidence_pages: list[int] = field(default_factory=list)
    medium_confidence_pages: list[int] = field(default_factory=list)
    escalated_pages: int = 0
    opus_reviews: int = 0


@dataclass
class PipelineMetrics:
    """Top-level metrics for a complete pipeline run."""

    pdf_path: str = ""
    total_pages: int = 0
    total_duration_ms: float = 0.0

    phases: list[PhaseMetrics] = field(default_factory=list)
    api: APIMetrics = field(default_factory=APIMetrics)
    verification: VerificationMetrics = field(default_factory=VerificationMetrics)

    # Content detected
    degraded_pages: list[int] = field(default_factory=list)
    handwriting_pages: list[int] = field(default_factory=list)
    images_processed: int = 0
    annotations_found: int = 0
    diagrams_found: int = 0
    charts_found: int = 0
    tables_found: int = 0

    def to_json(self) -> str:
        """Serialize to JSON string."""
        self.api.estimate_cost()
        return json.dumps(asdict(self), indent=2, default=str)

    def write(self, path: Path) -> None:
        """Write metrics JSON to file."""
        path.write_text(self.to_json())
