"""Publish NPM packages."""

from __future__ import annotations

import os
import sys
from typing import TYPE_CHECKING

from ci.lib import publish_npm
from ci.lib.catalog import NPM_PACKAGES

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig

_VALID_NAMES = {p["name"] for p in NPM_PACKAGES}


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("npm-publish", help="Publish NPM packages")
    p.add_argument("--target", nargs="+", required=True, help=f"Package names: {', '.join(sorted(_VALID_NAMES))}")
    p.set_defaults(func=run)


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run
    pkgs_by_name = {p["name"]: p for p in NPM_PACKAGES}
    for name in args.target:
        if name not in pkgs_by_name:
            print(f"Error: unknown package '{name}'. Valid: {', '.join(sorted(_VALID_NAMES))}", file=sys.stderr)
            sys.exit(1)

    npm_token = os.environ.get("NPM_TOKEN", "")
    if not npm_token and not dry_run:
        print("Error: NPM_TOKEN required", file=sys.stderr)
        sys.exit(1)

    for name in args.target:
        pkg = pkgs_by_name[name]
        print(f"Publishing {name}...", flush=True)
        output = publish_npm.publish(
            pkg["dir"], npm_token or "dry-run", dry_run=dry_run
        )
        print(f"  {output}", flush=True)
