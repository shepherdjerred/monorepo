"""Tests for domain validation and correction gating."""
from __future__ import annotations

import pytest

from pdf_extract.config import PipelineConfig
from pdf_extract.verify.domain import (
    _build_confusion_map,
    _is_known_confusion_pair,
    domain_validate,
    validate_correction,
)


@pytest.fixture()
def config() -> PipelineConfig:
    return PipelineConfig()


class TestConfusionPairs:
    """Test confusion pair detection."""

    def test_build_confusion_map(self) -> None:
        pairs = ["0/O", "1/l/I"]
        cmap = _build_confusion_map(pairs)
        assert "O" in cmap["0"]
        assert "0" in cmap["O"]
        assert "l" in cmap["1"]
        assert "I" in cmap["1"]
        assert "1" in cmap["l"]

    def test_known_confusion_zero_and_letter_o(self) -> None:
        pairs = ["0/O", "1/l/I"]
        assert _is_known_confusion_pair("0", "O", pairs)
        assert _is_known_confusion_pair("O", "0", pairs)

    def test_known_confusion_one_and_lowercase_l(self) -> None:
        pairs = ["1/l/I"]
        assert _is_known_confusion_pair("1", "l", pairs)
        assert _is_known_confusion_pair("l", "I", pairs)
        assert _is_known_confusion_pair("I", "1", pairs)

    def test_unknown_pair(self) -> None:
        pairs = ["0/O"]
        assert not _is_known_confusion_pair("a", "b", pairs)
        assert not _is_known_confusion_pair("0", "1", pairs)

    def test_rn_m_confusion(self) -> None:
        pairs = ["rn/m"]
        assert _is_known_confusion_pair("rn", "m", pairs)

    def test_five_and_letter_s_confusion(self) -> None:
        pairs = ["5/S"]
        assert _is_known_confusion_pair("5", "S", pairs)
        assert _is_known_confusion_pair("S", "5", pairs)


class TestDomainValidate:
    """Test regex-based domain validators."""

    def test_valid_date_no_warning(self, config: PipelineConfig) -> None:
        warnings = domain_validate("Meeting on 12/05/2024", config)
        # Valid date should not produce warnings
        assert all(w["type"] != "date" for w in warnings)

    def test_invalid_date_month_too_high(self, config: PipelineConfig) -> None:
        # 25/13/2024 — month 13 is invalid (but only flagged under certain heuristic)
        warnings = domain_validate("Date: 1/32/2024", config)
        date_warnings = [w for w in warnings if w["type"] == "date"]
        assert len(date_warnings) >= 1

    def test_malformed_email(self, config: PipelineConfig) -> None:
        # Double dots trigger the ".." malformation check
        warnings = domain_validate("Contact: user@domain..com", config)
        email_warnings = [w for w in warnings if w["type"] == "email"]
        assert len(email_warnings) >= 1

    def test_valid_email_no_warning(self, config: PipelineConfig) -> None:
        warnings = domain_validate("Contact: user@domain.com", config)
        email_warnings = [w for w in warnings if w["type"] == "email"]
        assert len(email_warnings) == 0

    def test_suspicious_currency(self, config: PipelineConfig) -> None:
        warnings = domain_validate("Price: $1,23", config)
        currency_warnings = [w for w in warnings if w["type"] == "currency"]
        assert len(currency_warnings) >= 1

    def test_valid_currency_no_warning(self, config: PipelineConfig) -> None:
        warnings = domain_validate("Price: $1,234.56", config)
        currency_warnings = [w for w in warnings if w["type"] == "currency"]
        assert len(currency_warnings) == 0

    def test_percentage_over_100(self, config: PipelineConfig) -> None:
        warnings = domain_validate("Growth: 150%", config)
        pct_warnings = [w for w in warnings if w["type"] == "percentage"]
        assert len(pct_warnings) >= 1

    def test_valid_percentage_no_warning(self, config: PipelineConfig) -> None:
        warnings = domain_validate("Growth: 42%", config)
        pct_warnings = [w for w in warnings if w["type"] == "percentage"]
        assert len(pct_warnings) == 0

    def test_disabled_validator(self) -> None:
        config = PipelineConfig(validate_dates=False)
        warnings = domain_validate("Date: 1/32/2024", config)
        date_warnings = [w for w in warnings if w["type"] == "date"]
        assert len(date_warnings) == 0


class TestValidateCorrection:
    """Test correction gating logic."""

    def test_empty_strings_rejected(self, config: PipelineConfig) -> None:
        assert not validate_correction("", "fixed", config)
        assert not validate_correction("original", "", config)

    def test_identical_rejected(self, config: PipelineConfig) -> None:
        assert not validate_correction("same", "same", config)

    def test_reasonable_correction_accepted(self, config: PipelineConfig) -> None:
        assert validate_correction("helo world", "hello world", config)

    def test_extreme_length_change_rejected(self, config: PipelineConfig) -> None:
        # 10x longer is too much
        assert not validate_correction("a", "a" * 100, config)

    def test_known_confusion_pair_accepted(self, config: PipelineConfig) -> None:
        # 0 -> O is a known confusion pair
        assert validate_correction("f00", "fO0", config)

    def test_unknown_single_char_rejected(self, config: PipelineConfig) -> None:
        # a -> z is not a known confusion pair
        assert not validate_correction("cat", "czt", config)

    def test_structured_field_tighter_ratio(self, config: PipelineConfig) -> None:
        # Structured fields (dates) have tighter length ratio
        assert not validate_correction("2024-01-01", "2024-01-01 extra long text here", config)
