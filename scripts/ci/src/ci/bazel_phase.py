"""Run a single build phase for a Bazel package.

Usage: uv run -m ci.bazel_phase --target //packages/birmel/... --phase build

Phases:
  build:     bazel build <target>
  lint:      bazel test --test_tag_filters=lint <target>
  typecheck: bazel test --test_tag_filters=typecheck <target>
  test:      bazel test --test_tag_filters=test <target>

Args:
  --target: Bazel target pattern (e.g. //packages/birmel/...)
  --phase: One of build, lint, typecheck, test
"""

from __future__ import annotations

import argparse

from ci.lib import bazel
from ci.lib.config import ReleaseConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a single build phase for a Bazel package")
    parser.add_argument("--target", required=True, help="Bazel target pattern (e.g. //packages/birmel/...)")
    parser.add_argument("--phase", required=True, choices=["build", "lint", "typecheck", "test"],
                        help="Build phase to run")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    target = args.target
    phase = args.phase
    print(f"Build #{config.build_number} (version={config.version}, branch={config.branch})", flush=True)
    print(f"Target: {target}, Phase: {phase}", flush=True)

    if phase == "build":
        print(f"\n--- Build: {target} ---", flush=True)
        bazel.build(target, bep_file="bazel-build-events.pb")
    else:
        print(f"\n--- {phase.title()}: {target} ---", flush=True)
        bazel.test(target, test_tag_filters=phase, bep_file=f"bazel-{phase}-events.pb")

    print(f"\n{phase.title()} phase completed successfully", flush=True)


if __name__ == "__main__":
    main()
