"""Push container images to GHCR."""

from __future__ import annotations

import os
import sys
from typing import TYPE_CHECKING

from ci.lib import bazel, buildkite, ghcr
from ci.lib.catalog import IMAGE_PUSH_TARGETS, INFRA_PUSH_TARGETS

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig

ALL_IMAGES = IMAGE_PUSH_TARGETS + INFRA_PUSH_TARGETS
_VALID_NAMES = {img["name"] for img in ALL_IMAGES}


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("image-push", help="Push container images to GHCR")
    p.add_argument("--target", nargs="+", required=True, help=f"Image names: {', '.join(sorted(_VALID_NAMES))}")
    p.set_defaults(func=run)


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run
    gh_token = os.environ.get("GH_TOKEN", "")
    if not gh_token and not dry_run:
        print("Error: GH_TOKEN required", file=sys.stderr)
        sys.exit(1)

    images_by_name = {img["name"]: img for img in ALL_IMAGES}
    for name in args.target:
        if name not in images_by_name:
            print(f"Error: unknown image '{name}'. Valid: {', '.join(sorted(_VALID_NAMES))}", file=sys.stderr)
            sys.exit(1)

    if not dry_run:
        ghcr.login(gh_token)

    for name in args.target:
        img = images_by_name[name]
        print(f"Pushing {name} ({img['target']})...", flush=True)
        output = bazel.run_capture(
            img["target"],
            stamp=True,
            embed_label=config.version,
            dry_run=dry_run,
            dry_run_stdout=f"sha256:{'0' * 64}",
        )
        if dry_run:
            versioned = f"{config.version}@sha256:dry-run-placeholder"
        else:
            versioned = ghcr.format_version_with_digest(config.version, output)
        buildkite.set_metadata(f"digest:{img['version_key']}", versioned)
        if not dry_run:
            print(f"  Digest: {versioned}", flush=True)
