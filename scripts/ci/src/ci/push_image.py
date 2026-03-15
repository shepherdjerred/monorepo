"""Push one container image to GHCR and store its digest in Buildkite metadata.

Usage: uv run -m ci.push_image --target //packages/birmel:image_push --version-key shepherdjerred/birmel

Pushes a single container image via ``bazel run --stamp //pkg:push``,
then stores the versioned digest as Buildkite metadata so downstream
steps (e.g. version_commit_back) can consume it.

Args:
  --target: Bazel push target (e.g. "//packages/birmel:image_push")
  --version-key: Key for versions.ts (e.g. "shepherdjerred/birmel")

Required env vars:
  GH_TOKEN - GitHub token for GHCR authentication
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH, BUILDKITE_COMMIT
"""

from __future__ import annotations

import argparse
import os
import sys

from ci.lib import bazel, buildkite, ghcr
from ci.lib.config import ReleaseConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Push one container image to GHCR")
    parser.add_argument("--target", required=True, help="Bazel push target (e.g. //packages/birmel:image_push)")
    parser.add_argument("--version-key", required=True, help="Key for versions.ts (e.g. shepherdjerred/birmel)")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping image push", flush=True)
        return

    gh_token = os.environ.get("GH_TOKEN", "")
    if not gh_token:
        print("GH_TOKEN not set, failing", flush=True)
        sys.exit(1)

    ghcr.login(gh_token)

    print(f"Pushing {args.target}", flush=True)
    output = bazel.run_capture(args.target, stamp=True, embed_label=config.version)

    versioned = ghcr.format_version_with_digest(config.version, output)
    buildkite.set_metadata(f"digest:{args.version_key}", versioned)

    print(f"Successfully pushed {args.target}", flush=True)
    print(f"  Digest: {versioned}", flush=True)


if __name__ == "__main__":
    main()
