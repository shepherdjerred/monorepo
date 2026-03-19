"""Cross-compile one Clauderon target and upload binary as Buildkite artifact.

Usage: uv run -m ci.clauderon_build --target x86_64-unknown-linux-gnu --filename clauderon-linux-x86_64
"""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from ci.lib import buildkite


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a single Clauderon target")
    parser.add_argument("--target", required=True, help="Rust target triple")
    parser.add_argument("--filename", required=True, help="Output binary name")
    parser.add_argument("--version", default=None, help="Override version (default: from Buildkite metadata)")
    args = parser.parse_args()

    version = args.version or buildkite.get_metadata("clauderon_version")
    if not version:
        print("No clauderon release detected, skipping", flush=True)
        return

    repo_root = _repo_root()

    print(f"Building clauderon v{version} for {args.target}", flush=True)

    subprocess.run(
        [
            "cargo",
            "build",
            "--release",
            "--target",
            args.target,
            "--manifest-path",
            str(repo_root / "packages/clauderon/Cargo.toml"),
        ],
        check=True,
    )

    src = repo_root / f"packages/clauderon/target/{args.target}/release/clauderon"
    dst = f"/tmp/{args.filename}"
    subprocess.run(["cp", str(src), dst], check=True)

    buildkite.artifact_upload(f"/tmp/{args.filename}")

    print(f"Built and uploaded {args.filename}", flush=True)


if __name__ == "__main__":
    main()
