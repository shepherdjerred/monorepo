"""Build and publish cooklang-for-obsidian to its separate GitHub repo.

Usage: uv run -m ci.cooklang_release

Builds the Obsidian plugin, then pushes artifacts (main.js, manifest.json,
styles.css) to the shepherdjerred/cooklang-for-obsidian repo and creates a
GitHub release with those files attached.

Required env vars:
  GITHUB_TOKEN - GitHub token with repo access
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from ci.lib import github

SEPARATE_REPO = "shepherdjerred/cooklang-for-obsidian"


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


_REPO_ROOT = _repo_root()
_PKG_DIR = _REPO_ROOT / "packages" / "cooklang-for-obsidian"


def _get_metadata(key: str, default: str = "") -> str:
    if shutil.which("buildkite-agent") is None:
        return default
    result = subprocess.run(
        ["buildkite-agent", "meta-data", "get", key, "--default", default],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else default


def _update_version(version: str) -> None:
    """Update version in manifest.json and package.json."""
    for filename in ("manifest.json", "package.json"):
        filepath = _PKG_DIR / filename
        with open(filepath) as f:
            data = json.load(f)
        data["version"] = version
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
    print(f"Updated version to {version} in manifest.json and package.json", flush=True)


def main() -> None:
    version = _get_metadata("cooklang_for_obsidian_version")
    if not version:
        print("No cooklang-for-obsidian release detected, skipping", flush=True)
        return

    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("GITHUB_TOKEN not set, skipping cooklang release", flush=True)
        return

    print(f"Publishing cooklang-for-obsidian v{version}", flush=True)

    # Update version in manifest and package.json
    _update_version(version)

    # Build the plugin
    print("\n--- Building plugin ---", flush=True)
    subprocess.run(
        ["bun", "run", "build"],
        cwd=str(_PKG_DIR),
        check=True,
    )

    # Commit artifacts to the separate repo via GitHub API
    print("\n--- Pushing to separate repo ---", flush=True)
    artifacts = {
        "main.js": _PKG_DIR / "main.js",
        "manifest.json": _PKG_DIR / "manifest.json",
        "styles.css": _PKG_DIR / "styles.css",
        "README.md": _PKG_DIR / "README.md",
        "LICENSE": _PKG_DIR / "LICENSE",
    }

    for name, path in artifacts.items():
        if not path.exists():
            print(f"Warning: {name} not found, skipping", flush=True)
            continue
        content = path.read_text()
        msg = github.commit_file(
            name, content, f"chore: update {name} for v{version}",
            token, repo=SEPARATE_REPO,
        )
        print(f"  {msg}", flush=True)

    # Create GitHub release with assets
    print(f"\n--- Creating GitHub release v{version} ---", flush=True)
    env = {**os.environ, "GH_TOKEN": token}
    release_assets: list[str] = []
    for name in ("main.js", "manifest.json", "styles.css"):
        path = artifacts[name]
        if path.exists():
            release_assets.append(str(path))

    subprocess.run(
        [
            "gh", "release", "create",
            version,
            *release_assets,
            "--repo", SEPARATE_REPO,
            "--title", f"v{version}",
            "--generate-notes",
        ],
        env=env,
        check=True,
    )

    print(f"\nCooklang-for-obsidian v{version} released", flush=True)


if __name__ == "__main__":
    main()
