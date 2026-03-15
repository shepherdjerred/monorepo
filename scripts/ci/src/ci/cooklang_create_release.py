"""Download artifacts and create a GitHub release.

Usage: uv run -m ci.cooklang_create_release

Downloads cooklang-for-obsidian build artifacts from Buildkite and creates
a GitHub release with those files attached on the separate repo.

Required env vars:
  GITHUB_TOKEN - GitHub token with repo access
"""
from __future__ import annotations

import os
import shutil
import subprocess

from ci.lib import buildkite

SEPARATE_REPO = "shepherdjerred/cooklang-for-obsidian"
RELEASE_ARTIFACTS = ["main.js", "manifest.json", "styles.css"]


def main() -> None:
    version = buildkite.get_metadata("cooklang_for_obsidian_version")
    if not version:
        print("No cooklang-for-obsidian release detected, skipping", flush=True)
        return

    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        msg = "GITHUB_TOKEN not set"
        raise RuntimeError(msg)

    print(f"Creating cooklang-for-obsidian v{version} release", flush=True)

    # Download artifacts
    print("\n--- Downloading artifacts ---", flush=True)
    for name in RELEASE_ARTIFACTS:
        if shutil.which("buildkite-agent"):
            subprocess.run(
                ["buildkite-agent", "artifact", "download", name, "/tmp/"],
                check=True,
            )
        print(f"  Downloaded {name}", flush=True)

    # Create GitHub release
    print(f"\n--- Creating GitHub release v{version} ---", flush=True)
    asset_paths = [f"/tmp/{name}" for name in RELEASE_ARTIFACTS]
    subprocess.run(
        [
            "gh", "release", "create",
            version,
            *asset_paths,
            "--repo", SEPARATE_REPO,
            "--title", f"v{version}",
            "--generate-notes",
        ],
        env={**os.environ, "GH_TOKEN": token},
        check=True,
    )

    print(f"\nCooklang-for-obsidian v{version} released", flush=True)


if __name__ == "__main__":
    main()
