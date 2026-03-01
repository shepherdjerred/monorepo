"""Run a single build phase for a Bazel package.

Usage: uv run -m ci.bazel_phase --target //packages/birmel/... --phase build

Phases:
  build:     bazel build <target> (+ optional stamped container images)
  lint:      bazel test --test_tag_filters=lint <target>
  typecheck: bazel test --test_tag_filters=typecheck <target>
  test:      bazel test --test_tag_filters=test <target>

Args:
  --target: Bazel target pattern (e.g. //packages/birmel/...)
  --phase: One of build, lint, typecheck, test
  --stamp-images: Also build stamped container images for release builds (build phase only)
"""

from __future__ import annotations

import argparse

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
    parser = argparse.ArgumentParser(description="Run a single build phase for a Bazel package")
    parser.add_argument("--target", required=True, help="Bazel target pattern (e.g. //packages/birmel/...)")
    parser.add_argument("--phase", required=True, choices=["build", "lint", "typecheck", "test"],
                        help="Build phase to run")
    parser.add_argument("--stamp-images", action="store_true", help="Build stamped container images for release")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    target = args.target
    phase = args.phase
    print(f"Build #{config.build_number} (version={config.version}, branch={config.branch})", flush=True)
    print(f"Target: {target}, Phase: {phase}", flush=True)

    if phase == "build":
        print(f"\n--- Build: {target} ---", flush=True)
        bazel.build(target, bep_file="bazel-build-events.pb")

        if args.stamp_images and config.is_release:
            prefix = target.replace("/...", "").rstrip(":")
            image_targets = [t for t in IMAGE_TARGETS if t.startswith(prefix)]
            if image_targets:
                print(f"\n--- Build container images (stamped): {', '.join(image_targets)} ---", flush=True)
                bazel.build(*image_targets, stamp=True)
            else:
                print("\n--- No container image targets for this package ---", flush=True)
    else:
        print(f"\n--- {phase.title()}: {target} ---", flush=True)
        bazel.test(target, test_tag_filters=phase, bep_file=f"bazel-{phase}-events.pb")

    print(f"\n{phase.title()} phase completed successfully", flush=True)


if __name__ == "__main__":
    main()
