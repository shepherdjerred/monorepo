"""Pipeline configuration: TOML file → frozen dataclass."""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_DEFAULT_CONFIG = Path(__file__).parent.parent.parent / "config.default.toml"


@dataclass(frozen=True)
class PipelineConfig:
    """Immutable pipeline configuration. Parsed from TOML."""

    # Pipeline
    backend: str = "docling"
    output_format: str = "markdown"
    log_level: str = "INFO"
    log_json: bool = False
    output_dir: Path = field(default_factory=lambda: Path("output"))

    # Extraction
    docling_vlm: bool = True
    mineru_backend: str = "hybrid-auto-engine"

    # Preprocessing
    preprocess_mode: str = "on_failure"
    upscale_model: str = "fsrcnn"
    min_dpi_threshold: float = 200.0
    min_contrast_threshold: float = 50.0

    # Handwriting
    handwriting_enabled: bool = True
    handwriting_detect_model: str = "gemini-2.5-flash"
    handwriting_extract_model: str = "gemini-2.5-pro"

    # Images
    mermaid_self_correct: str = "hand_drawn_only"
    mermaid_validator: str = "merval"
    mermaid_renderer: str = "kroki"
    classify_model: str = "gemini-2.5-flash"
    diagram_model: str = "gemini-2.5-flash"

    # Verification
    verify_enabled: bool = True
    verify_all_pages: bool = True
    table_cell_verification: bool = True
    geometric_risk_controller: bool = True
    grc_num_views: int = 5
    grc_consensus_threshold: int = 3
    anchored_model: str = "gemini-2.5-flash"

    # Escalation
    medium_model: str = "claude-sonnet-4-6"
    low_models: list[str] = field(default_factory=lambda: ["claude-sonnet-4-6", "gpt-4o"])
    unresolved_model: str = "claude-opus-4-6"
    max_opus_calls: int = 10

    # Prompts
    refusal_instruction: bool = True
    grounded_cot: bool = True
    confusion_pairs: list[str] = field(
        default_factory=lambda: ["0/O", "1/l/I", "5/S", "6/G", "8/B", "rn/m"]
    )

    # Domain validators
    validate_dates: bool = True
    validate_emails: bool = True
    validate_currencies: bool = True
    validate_phones: bool = True
    validate_percentages: bool = True
    column_type_consistency: bool = True

    # API keys (from env if not provided)
    google_api_key: str | None = None
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None

    # Metrics
    metrics_file: Path | None = None

    @classmethod
    def from_toml(cls, path: Path | None = None) -> PipelineConfig:
        """Load config from a TOML file, falling back to defaults."""
        config_path = path or _DEFAULT_CONFIG
        if not config_path.exists():
            return cls()

        with open(config_path, "rb") as f:
            raw = tomllib.load(f)

        flat = _flatten_toml(raw)

        # Read API keys from env if not in TOML
        if "google_api_key" not in flat:
            flat["google_api_key"] = os.environ.get("GOOGLE_API_KEY")
        if "anthropic_api_key" not in flat:
            flat["anthropic_api_key"] = os.environ.get("ANTHROPIC_API_KEY")
        if "openai_api_key" not in flat:
            flat["openai_api_key"] = os.environ.get("OPENAI_API_KEY")

        # Map TOML field names to dataclass field names where they differ
        field_map = {
            "enabled": "preprocess_mode",  # [preprocessing] enabled
        }

        known_fields = {f.name for f in cls.__dataclass_fields__.values()}
        filtered: dict[str, Any] = {}
        for k, v in flat.items():
            mapped = field_map.get(k, k)
            if mapped in known_fields:
                filtered[mapped] = v

        # Convert Path fields
        if "output_dir" in filtered and isinstance(filtered["output_dir"], str):
            filtered["output_dir"] = Path(filtered["output_dir"])
        if "metrics_file" in filtered and isinstance(filtered["metrics_file"], str):
            filtered["metrics_file"] = Path(filtered["metrics_file"])

        return cls(**filtered)

    def resolve_api_key(self, provider: str) -> str:
        """Get API key for a provider, raising if missing."""
        key_map = {
            "gemini": self.google_api_key or os.environ.get("GOOGLE_API_KEY"),
            "claude": self.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY"),
            "openai": self.openai_api_key or os.environ.get("OPENAI_API_KEY"),
        }
        key = key_map.get(provider)
        if not key:
            msg = f"No API key for {provider}. Set {provider.upper()}_API_KEY env var."
            raise ValueError(msg)
        return key


def _flatten_toml(raw: dict[str, Any]) -> dict[str, Any]:
    """Flatten nested TOML sections into a single dict."""
    flat: dict[str, Any] = {}
    for key, value in raw.items():
        if isinstance(value, dict):
            flat.update(value)
        else:
            flat[key] = value
    return flat
