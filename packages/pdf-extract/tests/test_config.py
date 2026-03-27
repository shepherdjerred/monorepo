"""Tests for pipeline configuration loading."""
from __future__ import annotations

from pathlib import Path

import pytest

from pdf_extract.config import PipelineConfig


class TestFromToml:
    """Test TOML config loading."""

    def test_default_config_loads(self) -> None:
        """Loading with no path returns defaults when config.default.toml exists."""
        config = PipelineConfig.from_toml()
        assert config.backend == "docling"
        assert config.output_format == "markdown"
        assert config.log_level == "INFO"

    def test_nonexistent_path_returns_defaults(self, tmp_path: Path) -> None:
        """Missing TOML file returns default config."""
        config = PipelineConfig.from_toml(tmp_path / "nonexistent.toml")
        assert config.backend == "docling"

    def test_custom_toml(self, tmp_path: Path) -> None:
        """Custom TOML values override defaults."""
        toml_path = tmp_path / "test.toml"
        toml_path.write_text(
            '[pipeline]\nbackend = "mineru"\nlog_level = "DEBUG"\n'
        )
        config = PipelineConfig.from_toml(toml_path)
        assert config.backend == "mineru"
        assert config.log_level == "DEBUG"

    def test_output_dir_converted_to_path(self, tmp_path: Path) -> None:
        """String output_dir in TOML is converted to Path."""
        toml_path = tmp_path / "test.toml"
        toml_path.write_text('[pipeline]\noutput_dir = "/tmp/out"\n')
        config = PipelineConfig.from_toml(toml_path)
        assert isinstance(config.output_dir, Path)
        assert config.output_dir == Path("/tmp/out")

    def test_unknown_fields_ignored(self, tmp_path: Path) -> None:
        """Unknown TOML fields don't cause errors."""
        toml_path = tmp_path / "test.toml"
        toml_path.write_text('[pipeline]\nbackend = "docling"\nunknown_field = "foo"\n')
        config = PipelineConfig.from_toml(toml_path)
        assert config.backend == "docling"


class TestResolveApiKey:
    """Test API key resolution."""

    def test_key_from_config(self) -> None:
        """API key from config is returned."""
        config = PipelineConfig(google_api_key="test-key")
        assert config.resolve_api_key("gemini") == "test-key"

    def test_key_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """API key from environment variable works."""
        monkeypatch.setenv("GOOGLE_API_KEY", "env-key")
        config = PipelineConfig()
        assert config.resolve_api_key("gemini") == "env-key"

    def test_missing_key_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Missing API key raises ValueError."""
        monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        config = PipelineConfig()
        with pytest.raises(ValueError, match="No API key"):
            config.resolve_api_key("gemini")

    def test_config_key_takes_precedence(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Config key is preferred over environment variable."""
        monkeypatch.setenv("GOOGLE_API_KEY", "env-key")
        config = PipelineConfig(google_api_key="config-key")
        assert config.resolve_api_key("gemini") == "config-key"


class TestDefaults:
    """Test default field values."""

    def test_confusion_pairs_default(self) -> None:
        config = PipelineConfig()
        assert "0/O" in config.confusion_pairs
        assert "rn/m" in config.confusion_pairs

    def test_low_models_default(self) -> None:
        config = PipelineConfig()
        assert "gpt-4o" in config.low_models
