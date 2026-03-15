"""Download built artifacts and push to separate GitHub repo.

Usage: uv run -m ci.cooklang_push

Downloads cooklang-for-obsidian build artifacts from Buildkite and commits
them to the shepherdjerred/cooklang-for-obsidian repo via the GitHub API.

Required env vars:
  GITHUB_TOKEN - GitHub token with repo access
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from ci.lib import buildkite, github

SEPARATE_REPO = "shepherdjerred/cooklang-for-obsidian"
ARTIFACTS = ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE"]


def main() -> None:
    version = buildkite.get_metadata("cooklang_for_obsidian_version")
    if not version:
        print("No cooklang-for-obsidian release detected, skipping", flush=True)
        return

    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        msg = "GITHUB_TOKEN not set"
        raise RuntimeError(msg)

    print(f"Pushing cooklang-for-obsidian v{version} to {SEPARATE_REPO}", flush=True)

    # Download artifacts
    print("\n--- Downloading artifacts ---", flush=True)
    for name in ARTIFACTS:
        if shutil.which("buildkite-agent"):
            subprocess.run(
                ["buildkite-agent", "artifact", "download", name, "/tmp/"],
                check=True,
            )
        content = Path(f"/tmp/{name}").read_text()
        msg = github.commit_file(
            name, content, f"chore: update {name} for v{version}",
            token, repo=SEPARATE_REPO,
        )
        print(f"  {msg}", flush=True)

    print(f"\nCooklang-for-obsidian v{version} pushed to {SEPARATE_REPO}", flush=True)


if __name__ == "__main__":
    main()
