"""Package and push Helm charts to ChartMuseum."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from ci.lib import helm
from ci.lib.catalog import HELM_CHARTS

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("helm-push", help="Package and push Helm charts")
    p.add_argument("--target", nargs="+", required=True, help=f"Chart names: {', '.join(HELM_CHARTS[:5])}...")
    p.set_defaults(func=run)


def _repo_root() -> Path:
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
    return Path(result.stdout.strip())


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run
    valid = set(HELM_CHARTS)
    for name in args.target:
        if name not in valid:
            print(f"Error: unknown chart '{name}'. Valid: {', '.join(sorted(valid))}", file=sys.stderr)
            sys.exit(1)

    cm_username = os.environ.get("CHARTMUSEUM_USERNAME", "")
    cm_password = os.environ.get("CHARTMUSEUM_PASSWORD", "")
    if (not cm_username or not cm_password) and not dry_run:
        print("Error: CHARTMUSEUM_USERNAME and CHARTMUSEUM_PASSWORD required", file=sys.stderr)
        sys.exit(1)

    repo_root = _repo_root()
    helm_dir = repo_root / "packages/homelab/src/cdk8s/helm"
    dist_dir = str(repo_root / "packages/homelab/src/cdk8s/dist")

    for chart_name in args.target:
        chart_dir = str(helm_dir / chart_name)
        print(f"Pushing {chart_name}...", flush=True)
        chart_path = helm.package(chart_dir, config.version, dist_dir=dist_dir, dry_run=dry_run)
        result = helm.push_to_chartmuseum(
            chart_path,
            username=cm_username or "dry-run",
            password=cm_password or "dry-run",
            dry_run=dry_run,
        )
        print(f"  {result}", flush=True)
