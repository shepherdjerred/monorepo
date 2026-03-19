"""Local CI/Release CLI for ad-hoc deploys without Buildkite.

Usage: uv run ci-local <command> [options]

Examples:
    ci-local homelab-deploy --target scout --dry-run
    ci-local image-push --target birmel
    ci-local helm-push --target scout-beta
    ci-local list-targets
"""

from __future__ import annotations

import argparse
import os
import tempfile
from typing import TYPE_CHECKING

from ci.lib.config import ReleaseConfig

if TYPE_CHECKING:
    from collections.abc import Sequence

from ci.local_commands import (
    argocd_sync,
    clauderon_release,
    cooklang_release,
    helm_push,
    homelab_deploy,
    image_push,
    list_targets,
    npm_publish,
    site_deploy,
    tag_release,
    tofu_apply,
    version_cmd,
)

_COMMANDS = [
    homelab_deploy,
    image_push,
    helm_push,
    argocd_sync,
    tofu_apply,
    site_deploy,
    cooklang_release,
    clauderon_release,
    tag_release,
    npm_publish,
    version_cmd,
    list_targets,
]


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="ci-local",
        description="Local CI/Release CLI for ad-hoc deploys",
    )
    parser.add_argument("--version", dest="override_version", help="Override auto-generated version")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without executing")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose output")

    subparsers = parser.add_subparsers(dest="command", required=True)
    for cmd_module in _COMMANDS:
        cmd_module.register(subparsers)

    args = parser.parse_args(argv)

    # Set up run-scoped staging directory
    if "MONOREPO_CI_RUN_DIR" not in os.environ:
        run_dir = tempfile.mkdtemp(prefix="monorepo-ci-")
        os.environ["MONOREPO_CI_RUN_DIR"] = run_dir
        if args.verbose:
            print(f"Run directory: {run_dir}", flush=True)

    config = ReleaseConfig.for_local(version=args.override_version)
    if args.verbose:
        print(f"Version: {config.version}", flush=True)
        print(f"Git SHA: {config.git_sha}", flush=True)
        print(f"Branch: {config.branch}", flush=True)

    # Dispatch to command
    args.func(args, config)


if __name__ == "__main__":
    main()
