"""Quality ratchet check - prevents suppression count from increasing.

Counts eslint-disable, @ts-expect-error, @ts-ignore, #[allow()] across
the codebase and compares against .quality-baseline.json.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


_REPO_ROOT = _repo_root()
BASELINE_FILE = _REPO_ROOT / ".quality-baseline.json"

PATTERNS = [
    {"name": "eslint-disable", "pattern": r"^\s*(//|/\*)\s*eslint-disable", "glob": "*.{ts,tsx,js,jsx}",
     "paths": ["packages/"], "exclude_path_patterns": ["/generated/"]},
    {"name": "ts-expect-error", "pattern": r"^\s*//\s*@ts-expect-error", "glob": "*.{ts,tsx}",
     "paths": ["packages/"], "exclude_path_patterns": ["/generated/"]},
    {"name": "ts-ignore", "pattern": r"^\s*//\s*@ts-ignore", "glob": "*.{ts,tsx}",
     "paths": ["packages/"], "exclude_path_patterns": ["/generated/"]},
    {"name": "ts-nocheck", "pattern": r"^\s*//\s*@ts-nocheck", "glob": "*.{ts,tsx}",
     "paths": ["packages/"], "exclude_path_patterns": ["/generated/"]},
    {"name": "rust-allow", "pattern": "#\\[allow\\(", "glob": "*.rs",
     "paths": ["packages/clauderon/src/"], "exclude_path_patterns": []},
    {"name": "prettier-ignore", "pattern": r"^\s*(//|/\*)\s*prettier-ignore", "glob": "*.{ts,tsx,js,jsx}",
     "paths": ["packages/"], "exclude_path_patterns": []},
]


def count_pattern(pattern: str, glob: str, paths: list[str] | None = None,
                  exclude_path_patterns: list[str] | None = None) -> int:
    """Count occurrences of a pattern across files matching glob."""
    search_paths = [str(_REPO_ROOT / p) for p in (paths or ["packages/"])]
    excludes = exclude_path_patterns or []
    result = subprocess.run(
        ["rg", "--count-matches", "--glob", glob,
         "--glob", "!node_modules", "--glob", "!dist", "--glob", "!archive",
         pattern, *search_paths],
        capture_output=True, text=True, check=False,
    )
    total = 0
    for line in result.stdout.strip().splitlines():
        parts = line.rsplit(":", 1)
        if len(parts) == 2:
            file_path = parts[0]
            # Filter out paths matching exclude patterns
            if any(ep in file_path for ep in excludes):
                continue
            try:
                total += int(parts[1])
            except ValueError:
                pass
    return total


def check() -> tuple[bool, str]:
    """Run quality ratchet check. Returns (passed, message)."""
    if not BASELINE_FILE.exists():
        return True, f"No baseline file ({BASELINE_FILE}), skipping quality ratchet"

    with open(BASELINE_FILE) as f:
        baseline = json.load(f)

    violations = []
    results = []
    for p in PATTERNS:
        current = count_pattern(p["pattern"], p["glob"], p.get("paths"),
                                p.get("exclude_path_patterns"))
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
