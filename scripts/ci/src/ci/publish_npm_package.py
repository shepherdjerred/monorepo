"""Publish one NPM package.

Usage: uv run -m ci.publish_npm_package --package-dir packages/bun-decompile

Publishes a single NPM package via ``bun publish``.  Only runs when
release-please has flagged a release via Buildkite metadata and an
NPM_TOKEN is available.

Args:
  --package-dir: Path to the package directory, relative to the repo root.

Required env vars:
  NPM_TOKEN - NPM authentication token
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH, BUILDKITE_COMMIT
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from ci.lib import buildkite, publish_npm
from ci.lib.config import ReleaseConfig


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish one NPM package")
    parser.add_argument("--package-dir", required=True, help="Package directory relative to repo root")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping NPM publish", flush=True)
        return

    release_created = buildkite.get_metadata("release_created", "false") == "true"
    if not release_created:
        print("No release created, skipping NPM publish", flush=True)
        return

    npm_token = os.environ.get("NPM_TOKEN", "")
    if not npm_token:
        print("NPM_TOKEN not set, skipping NPM publish", flush=True)
        return

    repo_root = _repo_root()
    full_path = repo_root / args.package_dir

    print(f"Publishing {full_path}", flush=True)
    publish_npm.publish(str(full_path), npm_token)
    print(f"Successfully published {args.package_dir}", flush=True)


if __name__ == "__main__":
    main()
