"""Wait for ArgoCD to report healthy after sync.

Usage: uv run -m ci.homelab_argocd_health [--app apps] [--timeout 300]

Required env vars:
  ARGOCD_TOKEN - ArgoCD API bearer token
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH, BUILDKITE_COMMIT
"""

from __future__ import annotations

import argparse
import os
import sys

from ci.lib import argocd
from ci.lib.config import ReleaseConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Wait for ArgoCD healthy status")
    parser.add_argument("--app", default="apps", help="ArgoCD application name (default: apps)")
    parser.add_argument("--timeout", type=int, default=300, help="Timeout in seconds (default: 300)")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping ArgoCD health check", flush=True)
        return

    argocd_token = os.environ.get("ARGOCD_TOKEN", "")
    if not argocd_token:
        print("ARGOCD_TOKEN not set, cannot check ArgoCD health", flush=True)
        sys.exit(1)

    print(f"--- Waiting for ArgoCD app '{args.app}' to be healthy (timeout: {args.timeout}s) ---", flush=True)
    health = argocd.wait_for_health(args.app, argocd_token, timeout=args.timeout)
    print(f"ArgoCD health: {health}", flush=True)


if __name__ == "__main__":
    main()
