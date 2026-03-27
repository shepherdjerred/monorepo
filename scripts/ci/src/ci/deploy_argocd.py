"""Trigger ArgoCD sync for an application.

Usage: uv run -m ci.deploy_argocd --app apps

Required env vars:
  ARGOCD_AUTH_TOKEN - ArgoCD API bearer token
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH
"""

from __future__ import annotations

import argparse
import os
import sys

from ci.lib import argocd
from ci.lib.config import ReleaseConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Trigger ArgoCD sync")
    parser.add_argument("--app", default="apps", help="ArgoCD app name (default: apps)")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping ArgoCD sync", flush=True)
        return

    argocd_token = os.environ.get("ARGOCD_AUTH_TOKEN", "")
    if not argocd_token:
        print("ARGOCD_AUTH_TOKEN not set, cannot sync", flush=True)
        sys.exit(1)

    print(f"Syncing ArgoCD app: {args.app}", flush=True)
    result = argocd.sync(args.app, argocd_token)
    print(result, flush=True)

    print(f"\nSuccessfully synced ArgoCD app: {args.app}", flush=True)


if __name__ == "__main__":
    main()
