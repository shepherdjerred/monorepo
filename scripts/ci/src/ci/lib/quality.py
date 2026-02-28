"""Quality ratchet check - prevents suppression count from increasing.

Counts eslint-disable, @ts-expect-error, @ts-ignore, #[allow()] across
the codebase and compares against .quality-baseline.json.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

BASELINE_FILE = ".quality-baseline.json"

PATTERNS = [
    {"name": "eslint-disable", "pattern": "eslint-disable", "glob": "*.{ts,tsx,js,jsx}"},
    {"name": "ts-expect-error", "pattern": "@ts-expect-error", "glob": "*.{ts,tsx}"},
    {"name": "ts-ignore", "pattern": "@ts-ignore", "glob": "*.{ts,tsx}"},
    {"name": "ts-nocheck", "pattern": "@ts-nocheck", "glob": "*.{ts,tsx}"},
    {"name": "rust-allow", "pattern": "#\\[allow\\(", "glob": "*.rs"},
    {"name": "prettier-ignore", "pattern": "prettier-ignore", "glob": "*.{ts,tsx,js,jsx}"},
]


def count_pattern(pattern: str, glob: str) -> int:
    """Count occurrences of a pattern across files matching glob."""
    result = subprocess.run(
        ["rg", "--count-matches", "--glob", glob, pattern, "packages/"],
        capture_output=True, text=True, check=False,
    )
    total = 0
    for line in result.stdout.strip().splitlines():
        parts = line.rsplit(":", 1)
        if len(parts) == 2:
            try:
                total += int(parts[1])
            except ValueError:
                pass
    return total


def check() -> tuple[bool, str]:
    """Run quality ratchet check. Returns (passed, message)."""
    baseline_path = Path(BASELINE_FILE)
    if not baseline_path.exists():
        return True, f"No baseline file ({BASELINE_FILE}), skipping quality ratchet"

    with open(baseline_path) as f:
        baseline = json.load(f)

    violations = []
    results = []
    for p in PATTERNS:
        current = count_pattern(p["pattern"], p["glob"])
        # Baseline stores per-file counts; sum the category total
        baseline_entry = baseline.get(p["name"], {})
        if isinstance(baseline_entry, dict):
            allowed = sum(baseline_entry.values())
        else:
            allowed = baseline_entry
        status = "PASS" if current <= allowed else "FAIL"
        results.append(f"  {p['name']}: {current}/{allowed} ({status})")
        if current > allowed:
            violations.append(f"{p['name']}: {current} > {allowed}")

    summary = "Quality Ratchet:\n" + "\n".join(results)
    if violations:
        return False, f"{summary}\n\nRatchet violations:\n" + "\n".join(violations)
    return True, summary
