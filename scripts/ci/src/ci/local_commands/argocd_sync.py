"""Trigger ArgoCD sync for specific applications."""

from __future__ import annotations

import os
import sys
from typing import TYPE_CHECKING

from ci.lib import argocd

if TYPE_CHECKING:
    import argparse

    from ci.lib.config import ReleaseConfig


def register(subparsers: argparse._SubParsersAction) -> None:  # type: ignore[type-arg]
    p = subparsers.add_parser("argocd-sync", help="Trigger ArgoCD sync")
    p.add_argument("--app", nargs="+", required=True, help="ArgoCD application names")
    p.add_argument("--wait-healthy", action="store_true", help="Wait for healthy status")
    p.add_argument("--timeout", type=int, default=300, help="Health check timeout in seconds")
    p.set_defaults(func=run)


def run(args: argparse.Namespace, config: ReleaseConfig) -> None:
    dry_run: bool = args.dry_run
    argocd_token = os.environ.get("ARGOCD_TOKEN", "")
    if not argocd_token and not dry_run:
        print("Error: ARGOCD_TOKEN required", file=sys.stderr)
        sys.exit(1)

    for app_name in args.app:
        print(f"Syncing {app_name}...", flush=True)
        msg = argocd.sync(app_name, argocd_token or "dry-run", dry_run=dry_run)
        print(f"  {msg}", flush=True)

    if args.wait_healthy and not dry_run:
        for app_name in args.app:
            print(f"Waiting for {app_name} to become healthy...", flush=True)
            health = argocd.wait_for_health(app_name, argocd_token, timeout=args.timeout)
            print(f"  {app_name}: {health}", flush=True)
