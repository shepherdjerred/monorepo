"""Quality metric helpers for evaluating extraction accuracy."""
from __future__ import annotations

import pytest


def extraction_quality(predicted: str, reference: str) -> dict[str, float]:
    """Compute extraction quality metrics.

    Returns dict with:
        - char_accuracy: character-level fuzzy ratio (0-100)
        - word_accuracy: word-level fuzzy ratio (0-100)
        - rouge_1: ROUGE-1 F1 score (0-1)
        - rouge_l: ROUGE-L F1 score (0-1)
    """
    from rapidfuzz import fuzz
    from rouge_score.rouge_scorer import RougeScorer

    char_accuracy = fuzz.ratio(predicted, reference)
    word_accuracy = fuzz.token_sort_ratio(predicted, reference)

    scorer = RougeScorer(["rouge1", "rougeL"], use_stemmer=False)
    rouge_scores = scorer.score(reference, predicted)

    return {
        "char_accuracy": char_accuracy,
        "word_accuracy": word_accuracy,
        "rouge_1": rouge_scores["rouge1"].fmeasure,
        "rouge_l": rouge_scores["rougeL"].fmeasure,
    }


class TestExtractionQuality:
    """Test quality metric computation."""

    def test_identical_strings(self) -> None:
        result = extraction_quality("hello world", "hello world")
        assert result["char_accuracy"] == 100.0
        assert result["word_accuracy"] == 100.0
        assert result["rouge_1"] == pytest.approx(1.0, abs=0.01)
        assert result["rouge_l"] == pytest.approx(1.0, abs=0.01)

    def test_completely_different(self) -> None:
        result = extraction_quality("abc", "xyz")
        assert result["char_accuracy"] < 50
        assert result["rouge_1"] < 0.5

    def test_minor_ocr_error(self) -> None:
        """Small OCR error should still give high accuracy."""
        result = extraction_quality(
            "The quick br0wn fox jumps over the lazy d0g.",
            "The quick brown fox jumps over the lazy dog.",
        )
        assert result["char_accuracy"] > 90
        assert result["word_accuracy"] > 80

    def test_empty_strings(self) -> None:
        """Two empty strings are considered a perfect match by rapidfuzz."""
        result = extraction_quality("", "")
        assert result["char_accuracy"] == 100.0

    def test_missing_words(self) -> None:
        """Missing words should reduce score but not to zero."""
        result = extraction_quality(
            "The quick fox jumps the lazy dog.",
            "The quick brown fox jumps over the lazy dog.",
        )
        assert 50 < result["char_accuracy"] < 100
        assert result["rouge_1"] > 0.5

    def test_returns_all_keys(self) -> None:
        result = extraction_quality("test", "test")
        assert "char_accuracy" in result
        assert "word_accuracy" in result
        assert "rouge_1" in result
        assert "rouge_l" in result
