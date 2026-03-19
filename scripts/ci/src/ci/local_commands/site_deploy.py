"""Build and deploy static sites."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from ci.lib import r2, runner, s3
from ci.lib.catalog import DEPLOY_SITES

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig

_VALID_NAMES = {str(s["name"]) for s in DEPLOY_SITES}


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("site-deploy", help="Build and deploy static sites")
    p.add_argument(
        "--target",
        nargs="+",
        required=True,
        help=f"Site names: {', '.join(sorted(_VALID_NAMES))}",
    )
    p.set_defaults(func=run)


def _repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
    )
    return Path(result.stdout.strip())


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run
    sites_by_name = {s["name"]: s for s in DEPLOY_SITES}
    for name in args.target:
        if name not in sites_by_name:
            print(
                f"Error: unknown site '{name}'. Valid: {', '.join(sorted(str(n) for n in _VALID_NAMES))}",
                file=sys.stderr,
            )
            sys.exit(1)

    repo_root = _repo_root()

    # Install dependencies once for all sites
    runner.run(["bun", "install"], cwd=str(repo_root), dry_run=dry_run)

    for name in args.target:
        site = sites_by_name[name]
        print(f"Deploying {name}...", flush=True)
        build_dir = repo_root / str(site["build_dir"])
        dist_dir = str(repo_root / str(site["dist_dir"]))
        build_cmd = str(site.get("build_cmd", ""))

        # Build
        if build_cmd:
            runner.run(build_cmd.split(), cwd=str(build_dir), dry_run=dry_run)

        # Deploy
        target = str(site.get("target", "s3"))
        if target == "r2":
            r2.sync(str(site["bucket"]), dist_dir, dry_run=dry_run)
        else:
            s3.sync(str(site["bucket"]), dist_dir, dry_run=dry_run)
        print(f"  Deployed {name}", flush=True)
