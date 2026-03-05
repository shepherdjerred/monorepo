"""Compliance check - verifies each package has required scripts and config."""
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


REQUIRED_SCRIPTS = ["lint", "typecheck"]
REQUIRED_FILES = ["eslint.config.ts"]
PACKAGES_DIR = _repo_root() / "packages"

# Packages to skip (not regular TS packages)
SKIP_PACKAGES = {
    "fonts", "dotfiles", "anki", "macos-cross-compiler",
    "castle-casters",  # Java project
    "resume",  # LaTeX project
}

# Directory names to skip when recursing into sub-packages
SKIP_DIRS = {
    "node_modules", "dist", "build", ".build", "generated",
    "examples", "example", "public",
}


def _check_package(pkg_dir: Path, display_name: str, *, check_files: bool = True) -> list[str]:
    """Check a single package directory for compliance. Returns list of violations.

    Args:
        check_files: If False, skip checking for required files (e.g. eslint.config.ts).
            Sub-packages can inherit config from their parent.
    """
    violations = []
    pkg_json = pkg_dir / "package.json"
    if not pkg_json.exists():
        return []

    with open(pkg_json) as f:
        pkg = json.load(f)

    scripts = pkg.get("scripts", {})
    for script_name in REQUIRED_SCRIPTS:
        if script_name not in scripts:
            violations.append(f"{display_name}: missing '{script_name}' script")

    if check_files:
        for filename in REQUIRED_FILES:
            if not (pkg_dir / filename).exists():
                violations.append(f"{display_name}: missing {filename}")

    return violations


def check() -> tuple[bool, str]:
    """Run compliance check. Returns (passed, message)."""
    violations = []
    checked = 0

    for pkg_dir in sorted(PACKAGES_DIR.iterdir()):
        if not pkg_dir.is_dir():
            continue
        name = pkg_dir.name
        if name.startswith("."):
            continue

        # BUILD.bazel is required for ALL packages (including SKIP_PACKAGES)
        if not (pkg_dir / "BUILD.bazel").exists():
            violations.append(f"{name}: missing BUILD.bazel")

        if name in SKIP_PACKAGES:
            continue

        pkg_json = pkg_dir / "package.json"
        if not pkg_json.exists():
            continue

        # Check top-level package
        checked += 1
        violations.extend(_check_package(pkg_dir, name))

        # Check sub-packages recursively (directories with their own package.json)
        for sub_pkg_json in sorted(pkg_dir.rglob("package.json")):
            sub_dir = sub_pkg_json.parent
            if sub_dir == pkg_dir:
                continue  # already checked top-level
            # Skip directories that shouldn't be checked
            if SKIP_DIRS & set(sub_pkg_json.relative_to(pkg_dir).parts):
                continue
            rel = sub_dir.relative_to(pkg_dir)
            sub_name = f"{name}/{rel}"
            checked += 1
            violations.extend(_check_package(sub_dir, sub_name, check_files=False))

    summary = f"Compliance check: {checked} packages checked"
    if violations:
        return False, f"{summary}\n\nViolations:\n" + "\n".join(violations)
    return True, f"{summary}, all passed"
