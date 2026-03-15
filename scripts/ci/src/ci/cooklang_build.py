"""Build the cooklang-for-obsidian plugin and upload artifacts.

Usage: uv run -m ci.cooklang_build

Builds the Obsidian plugin and uploads build artifacts via Buildkite's
artifact system for consumption by downstream steps.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from ci.lib import buildkite

ARTIFACTS = ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE"]


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


def _update_version(pkg_dir: Path, version: str) -> None:
    """Update version in manifest.json and package.json."""
    for filename in ("manifest.json", "package.json"):
        filepath = pkg_dir / filename
        with open(filepath) as f:
            data = json.load(f)
        data["version"] = version
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
    print(f"Updated version to {version} in manifest.json and package.json", flush=True)


def main() -> None:
    version = buildkite.get_metadata("cooklang_for_obsidian_version")
    if not version:
        print("No cooklang-for-obsidian release detected, skipping", flush=True)
        return

    print(f"Building cooklang-for-obsidian v{version}", flush=True)

    repo_root = _repo_root()
    pkg_dir = repo_root / "packages" / "cooklang-for-obsidian"

    # Update version in manifest and package.json
    _update_version(pkg_dir, version)

    # Install dependencies
    print("\n--- Installing dependencies ---", flush=True)
    subprocess.run(["bun", "install"], cwd=str(repo_root), check=True)

    # Build the plugin
    print("\n--- Building plugin ---", flush=True)
    subprocess.run(["bun", "run", "build"], cwd=str(pkg_dir), check=True)

    # Upload artifacts
    print("\n--- Uploading artifacts ---", flush=True)
    for name in ARTIFACTS:
        src = pkg_dir / name
        if not src.exists():
            print(f"Warning: {name} not found, skipping", flush=True)
            continue
        shutil.copy2(str(src), f"/tmp/{name}")
        if shutil.which("buildkite-agent"):
            subprocess.run(
                ["buildkite-agent", "artifact", "upload", f"/tmp/{name}"],
                check=True,
            )
            print(f"  Uploaded {name}", flush=True)
        else:
            print(f"  Copied {name} to /tmp (buildkite-agent not available)", flush=True)

    print(f"\nCooklang-for-obsidian v{version} build complete", flush=True)


if __name__ == "__main__":
    main()
