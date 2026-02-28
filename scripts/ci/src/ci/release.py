"""Run release-please to create release PRs and GitHub releases.

Usage: uv run -m ci.release

Runs release-please release-pr and github-release commands, then
communicates results to downstream Buildkite steps via metadata.

Ported from .dagger/src/index-release-helpers.ts.

Required env vars:
  GITHUB_TOKEN - GitHub personal access token
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess

REPO_URL = "shepherdjerred/monorepo"


def _run_release_please(subcommand: str, token: str) -> tuple[bool, str]:
    """Run a release-please subcommand and return (success, output)."""
    cmd = [
        "release-please",
        subcommand,
        f"--token={token}",
        f"--repo-url={REPO_URL}",
        "--target-branch=main",
    ]
    print(f"Running: release-please {subcommand}", flush=True)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=False,
    )
    output = result.stdout + result.stderr
    print(output, flush=True)
    return result.returncode == 0, output


def _set_metadata(key: str, value: str) -> None:
    """Set Buildkite metadata. No-op if buildkite-agent is not available."""
    if shutil.which("buildkite-agent") is None:
        print(f"buildkite-agent not found, skipping meta-data set {key}={value}", flush=True)
        return
    subprocess.run(
        ["buildkite-agent", "meta-data", "set", key, value],
        check=False,
    )


def main() -> None:
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("GITHUB_TOKEN not set, skipping release-please", flush=True)
        _set_metadata("release_created", "false")
        return

    # Phase 1: release-pr
    print("\n--- release-please release-pr ---", flush=True)
    pr_success, pr_output = _run_release_please("release-pr", token)
    print(f"Release PR (success={pr_success})", flush=True)

    # Phase 2: github-release
    print("\n--- release-please github-release ---", flush=True)
    release_success, release_output = _run_release_please("github-release", token)
    print(f"GitHub Release (success={release_success})", flush=True)

    # Detect whether a release was created
    release_created = release_success and (
        "github.com" in release_output
        or "Created release" in release_output
        or "created release" in release_output
    )

    _set_metadata("release_created", str(release_created).lower())
    print(f"\nRelease created: {release_created}", flush=True)

    # Detect clauderon release
    clauderon_match = re.search(r"clauderon-v([\d.]+)", release_output)
    if clauderon_match:
        clauderon_version = clauderon_match.group(1)
        _set_metadata("clauderon_version", clauderon_version)
        print(f"Detected clauderon release: v{clauderon_version}", flush=True)

    # release-please failures are non-fatal (it may just have nothing to do)
    print("\nRelease step completed", flush=True)


if __name__ == "__main__":
    main()
