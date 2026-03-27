"""Layer 3: Domain validators and correction gating."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from pdf_extract.lib import get_logger

if TYPE_CHECKING:
    from pdf_extract.config import PipelineConfig

log = get_logger("verify.domain")

# ---------------------------------------------------------------------------
# Confusion pairs (default set, configurable via config)
# ---------------------------------------------------------------------------

_DEFAULT_CONFUSION_PAIRS: dict[str, set[str]] = {}


def _build_confusion_map(pairs: list[str]) -> dict[str, set[str]]:
    """Build a lookup from a list like ["0/O", "1/l/I"]."""
    mapping: dict[str, set[str]] = {}
    for group in pairs:
        chars = group.split("/")
        for ch in chars:
            mapping[ch] = set(chars) - {ch}
    return mapping


def _is_known_confusion_pair(
    char_from: str, char_to: str, pairs: list[str]
) -> bool:
    """Check if a single-character substitution is a known confusion pair."""
    confusion_map = _build_confusion_map(pairs)
    return char_to in confusion_map.get(char_from, set())


# ---------------------------------------------------------------------------
# Edit distance + diff helpers
# ---------------------------------------------------------------------------


def _edit_distance(a: str, b: str) -> int:
    """Compute Levenshtein edit distance."""
    if len(a) < len(b):
        return _edit_distance(b, a)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            cost = 0 if ca == cb else 1
            curr.append(min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost))
        prev = curr
    return prev[-1]


def _find_single_char_diff(original: str, corrected: str) -> tuple[str, str]:
    """Find the single character that changed between two strings of equal length."""
    for _i, (a, b) in enumerate(zip(original, corrected, strict=False)):
        if a != b:
            return a, b
    return "", ""


def _looks_like_structured_field(text: str) -> bool:
    """Check if text looks like a structured field (date, amount, ID, etc.)."""
    patterns = [
        r"^\d{1,4}[-/\.]\d{1,2}[-/\.]\d{1,4}$",  # date
        r"^[\$\u20ac\u00a3\u00a5]?\s?[\d,]+\.?\d*$",  # currency
        r"^[A-Z]{2,}-?\d{3,}$",  # ID codes
        r"^\+?\d[\d\s\-()]+$",  # phone
        r"^[\w.+-]+@[\w-]+\.[\w.]+$",  # email
    ]
    return any(re.match(p, text.strip()) for p in patterns)


# ---------------------------------------------------------------------------
# Domain validation (regex-based)
# ---------------------------------------------------------------------------

# Date patterns
_DATE_PATTERNS = [
    re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b"),
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
    re.compile(r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}\b", re.IGNORECASE),
]

_EMAIL_PATTERN = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")

_CURRENCY_PATTERN = re.compile(
    r"[\$\u20ac\u00a3\u00a5]\s?[\d,]+\.?\d*"
)

_PHONE_PATTERN = re.compile(
    r"\b\+?\d{1,3}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{1,4}[\s\-.]?\d{1,9}\b"
)

_PERCENTAGE_PATTERN = re.compile(r"\b\d+\.?\d*\s?%")


def domain_validate(text: str, config: PipelineConfig) -> list[dict[str, str]]:
    """Run regex-based domain validators on text. Returns list of warnings.

    Each warning is a dict with keys: type, value, location, issue.
    """
    warnings: list[dict[str, str]] = []

    if config.validate_dates:
        for pat in _DATE_PATTERNS:
            for match in pat.finditer(text):
                val = match.group()
                # Check for obviously invalid dates (month > 12, day > 31)
                parts = re.split(r"[-/\.]", val)
                if len(parts) >= 3:
                    nums = [int(p) for p in parts if p.isdigit()]
                    if len(nums) >= 3 and (
                        nums[1] > 31 or (nums[0] <= 12 and nums[1] > 12 and nums[0] > 0)
                    ):
                            warnings.append({
                                "type": "date",
                                "value": val,
                                "location": f"offset {match.start()}",
                                "issue": "potentially invalid date",
                            })

    if config.validate_emails:
        for match in _EMAIL_PATTERN.finditer(text):
            val = match.group()
            # Check for common OCR issues in emails
            if ".." in val or val.endswith(".") or "@." in val:
                warnings.append({
                    "type": "email",
                    "value": val,
                    "location": f"offset {match.start()}",
                    "issue": "malformed email (possible OCR error)",
                })

    if config.validate_currencies:
        for match in _CURRENCY_PATTERN.finditer(text):
            val = match.group()
            # Check for suspicious patterns like $1,23 (missing digit)
            if re.search(r",\d{1,2}(?:\.\d+)?$", val) and not re.search(r",\d{3}", val):
                warnings.append({
                    "type": "currency",
                    "value": val,
                    "location": f"offset {match.start()}",
                    "issue": "suspicious grouping (possible OCR error)",
                })

    if config.validate_phones:
        for match in _PHONE_PATTERN.finditer(text):
            val = match.group()
            digits = re.sub(r"\D", "", val)
            if len(digits) < 7 or len(digits) > 15:
                warnings.append({
                    "type": "phone",
                    "value": val,
                    "location": f"offset {match.start()}",
                    "issue": f"unusual digit count ({len(digits)})",
                })

    if config.validate_percentages:
        for match in _PERCENTAGE_PATTERN.finditer(text):
            val = match.group()
            num = float(re.sub(r"[^\d.]", "", val))
            if num > 100:
                warnings.append({
                    "type": "percentage",
                    "value": val,
                    "location": f"offset {match.start()}",
                    "issue": "percentage exceeds 100%",
                })

    return warnings


# ---------------------------------------------------------------------------
# Correction validation gate
# ---------------------------------------------------------------------------


def validate_correction(
    original: str,
    corrected: str,
    config: PipelineConfig,
) -> bool:
    """Gate every correction through deterministic checks.

    Returns True if the correction should be applied, False to reject it.
    """
    if not original or not corrected:
        return False

    if original == corrected:
        return False

    # Length ratio check (tighter for structured fields)
    ratio = len(corrected) / max(len(original), 1)
    if _looks_like_structured_field(original):
        if not (0.5 <= ratio <= 2.0):
            log.info(
                "correction.rejected_length",
                original=original,
                corrected=corrected,
                ratio=ratio,
                structured=True,
            )
            return False
    else:
        if not (0.3 <= ratio <= 3.0):
            log.info(
                "correction.rejected_length",
                original=original,
                corrected=corrected,
                ratio=ratio,
            )
            return False

    # Single-char correction: only accept known confusion pairs
    dist = _edit_distance(original, corrected)
    if dist == 1 and len(original) == len(corrected):
        char_from, char_to = _find_single_char_diff(original, corrected)
        if not _is_known_confusion_pair(char_from, char_to, config.confusion_pairs):
            log.warning(
                "correction.unknown_single_char",
                original=original,
                corrected=corrected,
                char_from=char_from,
                char_to=char_to,
            )
            return False

    return True
