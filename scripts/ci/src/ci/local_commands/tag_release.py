"""Create a git tag and GitHub release."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("tag-release", help="Create git tag and GitHub release")
    p.add_argument("--tag", required=True, help="Tag name (e.g. v1.2.3)")
    p.set_defaults(func=run)


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run
    tag: str = args.tag

    token = os.environ.get("GH_TOKEN", "")
    if not token and not dry_run:
        result = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=False)
        token = result.stdout.strip() if result.returncode == 0 else ""
    if not token and not dry_run:
        print("Error: GH_TOKEN required", file=sys.stderr)
        sys.exit(1)

    print(f"Creating tag {tag}...", flush=True)
    if dry_run:
        print(f"  [DRY RUN] git tag {tag}", flush=True)
        print(f"  [DRY RUN] gh release create {tag}", flush=True)
    else:
        subprocess.run(["git", "tag", tag], check=True)
        subprocess.run(["git", "push", "origin", tag], check=True)
        subprocess.run(
            ["gh", "release", "create", tag, "--generate-notes"],
            env={**os.environ, "GH_TOKEN": token},
            check=True,
        )
    print(f"Tag {tag} created", flush=True)
