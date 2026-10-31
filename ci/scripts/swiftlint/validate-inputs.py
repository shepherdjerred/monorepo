"""Keep the CI producer's frozen inputs aligned with the version catalog."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def validate(root: Path) -> str:
    pins: object = json.loads((root / "ci/scripts/swiftlint/pins.json").read_text(encoding="utf-8"))
    catalog: object = json.loads((root / "packages/version-catalog/src/catalog.json").read_text(encoding="utf-8"))
    if not isinstance(pins, dict) or not isinstance(catalog, dict):
        raise ValueError("Invalid SwiftLint input documents")
    entries = catalog.get("entries")
    if not isinstance(entries, list):
        raise ValueError("Invalid version catalog entries")
    values: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid version catalog entry")
        name, value = entry.get("name"), entry.get("value")
        if not isinstance(name, str) or not isinstance(value, str) or name in values:
            raise ValueError("Invalid or duplicate version catalog value")
        values[name] = value
    version = pins.get("version")
    builder = pins.get("builderImage")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Invalid SwiftLint version pin")
    if "realm/SwiftLint" not in values or "docker.io/library/swift" not in values:
        raise ValueError("SwiftLint toolchain values are missing from the version catalog")
    expected_builder = "docker.io/library/swift:" + values["docker.io/library/swift"]
    if version != values["realm/SwiftLint"] or builder != expected_builder:
        raise ValueError("SwiftLint producer does not match the version catalog")
    dockerfile = (root / "ci/ci-image/Dockerfile").read_text(encoding="utf-8")
    if not isinstance(builder, str) or f"ARG SWIFTLINT_BUILDER_IMAGE={builder}\n" not in dockerfile:
        raise ValueError("SwiftLint builder Dockerfile does not match its immutable input")
    return version


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: validate-inputs.py <repository-root>")
    print(validate(Path(sys.argv[1])))
