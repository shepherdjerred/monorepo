"""Cross-compile Clauderon and upload binaries to GitHub release.

Usage: uv run -m ci.clauderon_release

Required env vars:
  GITHUB_TOKEN - GitHub token for release asset upload
"""
from __future__ import annotations

import os
import shutil
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

LINUX_TARGETS = [
    {"target": "x86_64-unknown-linux-gnu", "filename": "clauderon-linux-x86_64"},
    {"target": "aarch64-unknown-linux-gnu", "filename": "clauderon-linux-arm64"},
]


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


def main() -> None:
    version = _get_metadata("clauderon_version")
    if not version:
        print("No clauderon release detected, skipping", flush=True)
        return

    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("GITHUB_TOKEN not set, skipping clauderon release", flush=True)
        return

    print(f"Building clauderon v{version} for Linux targets", flush=True)

    binaries = []
    for target_info in LINUX_TARGETS:
        target = target_info["target"]
        filename = target_info["filename"]
        print(f"\n--- Building {filename} ({target}) ---", flush=True)

        subprocess.run(
            [
                "cargo",
                "build",
                "--release",
                "--target",
                target,
                "--manifest-path",
                str(_REPO_ROOT / "packages/clauderon/Cargo.toml"),
            ],
            check=True,
        )

        src = str(_REPO_ROOT / f"packages/clauderon/target/{target}/release/clauderon")
        dst = f"/tmp/{filename}"
        subprocess.run(["cp", src, dst], check=True)
        binaries.append((filename, dst))
        print(f"Built {filename}", flush=True)

    # Upload to GitHub release
    tag = f"clauderon-v{version}"
    print(f"\n--- Uploading to GitHub release {tag} ---", flush=True)
    for filename, path in binaries:
        subprocess.run(
            [
                "gh",
                "release",
                "upload",
                tag,
                path,
                "--repo",
                "shepherdjerred/monorepo",
                "--clobber",
            ],
            env={**os.environ, "GH_TOKEN": token},
            check=True,
        )
        print(f"Uploaded {filename}", flush=True)

    print("\nClauderon release completed", flush=True)


if __name__ == "__main__":
    main()
