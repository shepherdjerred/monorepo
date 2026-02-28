"""Build and test the monorepo using Bazel.

Usage: uv run -m ci.build_and_test

Runs:
  1. bazel build //...
  2. bazel test //...
  3. Quality ratchet check
  4. Compliance check
  5. bazel build for all container image targets (with --stamp)
"""

from __future__ import annotations

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
    config = ReleaseConfig.from_env()
    print(f"Build #{config.build_number} (version={config.version}, branch={config.branch})", flush=True)

    print("\n--- Build all targets ---", flush=True)
    bazel.build("//...")

    print("\n--- Test all targets ---", flush=True)
    bazel.test("//...")

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
        bazel.build(*IMAGE_TARGETS, stamp=True)


if __name__ == "__main__":
    main()
