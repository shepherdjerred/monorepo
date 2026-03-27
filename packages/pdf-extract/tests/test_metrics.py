"""Tests for metrics collection and serialization."""
from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING

from pdf_extract.metrics import APIMetrics, PhaseMetrics, PipelineMetrics

if TYPE_CHECKING:
    from pathlib import Path


class TestPhaseMetrics:
    """Test phase timing."""

    def test_start_stop_records_duration(self) -> None:
        phase = PhaseMetrics(name="test")
        phase.start()
        time.sleep(0.01)
        phase.stop()
        assert phase.duration_ms > 0
        assert phase.started_at > 0
        assert phase.ended_at >= phase.started_at

    def test_initial_values(self) -> None:
        phase = PhaseMetrics(name="init")
        assert phase.duration_ms == 0.0
        assert phase.items_processed == 0
        assert phase.errors == 0


class TestAPIMetrics:
    """Test cost estimation."""

    def test_estimate_cost_zero_tokens(self) -> None:
        api = APIMetrics()
        cost = api.estimate_cost()
        assert cost == 0.0
        assert api.estimated_cost_usd == 0.0

    def test_estimate_cost_gemini(self) -> None:
        api = APIMetrics(gemini_input_tokens=1_000_000, gemini_output_tokens=1_000_000)
        cost = api.estimate_cost()
        # Gemini 3.1 Pro: $2.00/MTok input + $12.00/MTok output = $14.00
        assert abs(cost - 14.00) < 0.01

    def test_estimate_cost_gemini_pro(self) -> None:
        api = APIMetrics(gemini_pro_input_tokens=1_000_000, gemini_pro_output_tokens=1_000_000)
        cost = api.estimate_cost()
        # Gemini 3.1 Pro (handwriting): $2.00/MTok input + $12.00/MTok output = $14.00
        assert abs(cost - 14.00) < 0.01

    def test_estimate_cost_claude_sonnet(self) -> None:
        api = APIMetrics(claude_sonnet_input_tokens=1_000_000, claude_sonnet_output_tokens=1_000_000)
        cost = api.estimate_cost()
        # Sonnet: $3.00/MTok input + $15.00/MTok output = $18.00
        assert abs(cost - 18.00) < 0.01

    def test_estimate_cost_mixed_providers(self) -> None:
        api = APIMetrics(
            gemini_input_tokens=500_000,
            gemini_output_tokens=100_000,
            claude_opus_input_tokens=200_000,
            claude_opus_output_tokens=50_000,
        )
        cost = api.estimate_cost()
        assert cost > 0
        assert api.estimated_cost_usd == cost


class TestPipelineMetrics:
    """Test top-level metrics."""

    def test_to_json_is_valid(self) -> None:
        metrics = PipelineMetrics(pdf_path="test.pdf", total_pages=5)
        result = metrics.to_json()
        parsed = json.loads(result)
        assert parsed["pdf_path"] == "test.pdf"
        assert parsed["total_pages"] == 5
        assert "api" in parsed
        assert "verification" in parsed

    def test_to_json_with_phases(self) -> None:
        metrics = PipelineMetrics()
        phase = PhaseMetrics(name="extraction")
        phase.start()
        phase.stop()
        metrics.phases.append(phase)
        parsed = json.loads(metrics.to_json())
        assert len(parsed["phases"]) == 1
        assert parsed["phases"][0]["name"] == "extraction"

    def test_write_to_file(self, tmp_path: Path) -> None:
        metrics = PipelineMetrics(pdf_path="test.pdf")
        out = tmp_path / "metrics.json"
        metrics.write(out)
        assert out.exists()
        parsed = json.loads(out.read_text())
        assert parsed["pdf_path"] == "test.pdf"
