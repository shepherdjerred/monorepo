"""Build and test a single Bazel package.

Usage: uv run -m ci.bazel_package --target //packages/birmel/...

Runs:
  1. bazel build <target>
  2. bazel test <target>
  3. (optional) bazel build stamped container image targets

Args:
  --target: Bazel target pattern (e.g. //packages/birmel/...)
  --stamp-images: Also build stamped container images for release builds
"""

from __future__ import annotations

import argparse
import sys

from ci.lib import bazel
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
    parser = argparse.ArgumentParser(description="Build and test a single Bazel package")
    parser.add_argument("--target", required=True, help="Bazel target pattern (e.g. //packages/birmel/...)")
    parser.add_argument("--stamp-images", action="store_true", help="Build stamped container images for release")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    target = args.target
    print(f"Build #{config.build_number} (version={config.version}, branch={config.branch})", flush=True)
    print(f"Target: {target}", flush=True)

    print(f"\n--- Build: {target} ---", flush=True)
    bazel.build(target, bep_file="bazel-build-events.pb")

    print(f"\n--- Test: {target} ---", flush=True)
    bazel.test(target, bep_file="bazel-test-events.pb")

    if args.stamp_images and config.is_release:
        prefix = target.replace("/...", "").rstrip(":")
        image_targets = [t for t in IMAGE_TARGETS if t.startswith(prefix)]
        if image_targets:
            print(f"\n--- Build container images (stamped): {', '.join(image_targets)} ---", flush=True)
            bazel.build(*image_targets, stamp=True)
        else:
            print("\n--- No container image targets for this package ---", flush=True)

    print("\nPackage build completed successfully", flush=True)


if __name__ == "__main__":
    main()
