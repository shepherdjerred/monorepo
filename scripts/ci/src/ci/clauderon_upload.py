"""Download compiled Clauderon binaries from artifacts and upload to GitHub release.

Usage: uv run -m ci.clauderon_upload

Required env vars:
  GITHUB_TOKEN - GitHub token for release asset upload
"""
from __future__ import annotations

import os
import subprocess

from ci.lib import buildkite

FILENAMES = [
    "clauderon-linux-x86_64",
    "clauderon-linux-arm64",
]


def main() -> None:
    version = buildkite.get_metadata("clauderon_version")
    if not version:
        print("No clauderon release detected, skipping", flush=True)
        return

    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("GITHUB_TOKEN not set, skipping clauderon upload", flush=True)
        return

    print(f"Downloading clauderon v{version} artifacts", flush=True)

    for filename in FILENAMES:
        buildkite.artifact_download(filename, "/tmp")
        print(f"Downloaded {filename}", flush=True)

    tag = f"clauderon-v{version}"
    print(f"\nUploading to GitHub release {tag}", flush=True)

    for filename in FILENAMES:
        subprocess.run(
            [
                "gh",
                "release",
                "upload",
                tag,
                f"/tmp/{filename}",
                "--repo",
                "shepherdjerred/monorepo",
                "--clobber",
            ],
            env={**os.environ, "GH_TOKEN": token},
            check=True,
        )
        print(f"Uploaded {filename}", flush=True)

    print("\nClauderon upload completed", flush=True)


if __name__ == "__main__":
    main()
