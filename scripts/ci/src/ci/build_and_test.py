"""Build and test the monorepo using Bazel.

Usage: uv run -m ci.build_and_test [--targets TARGET ...]

Runs:
  1. bazel build (specified targets or //...)
  2. bazel test (specified targets or //...)
  3. Quality ratchet check
  4. Compliance check
  5. bazel build for all container image targets (with --stamp)

Args:
  --targets: Specific Bazel targets to build/test (default: //...)
"""

from __future__ import annotations

import argparse
import sys

from ci.lib import bazel, compliance, quality
from ci.lib.config import ReleaseConfig

# Container image targets that need to be built (with --stamp for version embedding)
IMAGE_TARGETS = [
    "//packages/birmel:image",
    "//packages/sentinel:image",
    "//packages/tasknotes-server:image",
    "//packages/scout-for-lol:image",
    "//packages/discord-plays-pokemon:image",
    "//packages/starlight-karma-bot:image",
    "//packages/better-skill-capped/fetcher:image",
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and test the monorepo")
    parser.add_argument("--targets", nargs="+", default=["//..."], help="Bazel targets to build/test")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    targets = args.targets
    target_str = " ".join(targets)
    print(f"Build #{config.build_number} (version={config.version}, branch={config.branch})", flush=True)
    print(f"Targets: {target_str}", flush=True)

    print(f"\n--- Build targets: {target_str} ---", flush=True)
    bazel.build(*targets, bep_file="bazel-build-events.pb")

    print(f"\n--- Test targets: {target_str} ---", flush=True)
    bazel.test(*targets, bep_file="bazel-test-events.pb")

    print("\n--- Quality ratchet check ---", flush=True)
    passed, msg = quality.check()
    print(msg, flush=True)
    if not passed:
        print("Quality ratchet failed!", flush=True)
        sys.exit(1)

    print("\n--- Compliance check ---", flush=True)
    passed, msg = compliance.check()
    print(msg, flush=True)
    if not passed:
        print("Compliance check failed!", flush=True)
        sys.exit(1)

    if config.is_release:
        print("\n--- Build container images (stamped) ---", flush=True)
        # Only build image targets that overlap with the specified targets
        if targets == ["//..."]:
            image_targets = IMAGE_TARGETS
        else:
            # Extract package prefixes from targets
            prefixes = set()
            for t in targets:
                # //packages/foo/... -> //packages/foo
                prefix = t.replace("/...", "").rstrip(":")
                prefixes.add(prefix)
            image_targets = [
                t for t in IMAGE_TARGETS
                if any(t.startswith(p) for p in prefixes)
            ]
        if image_targets:
            bazel.build(*image_targets, stamp=True)


if __name__ == "__main__":
    main()
