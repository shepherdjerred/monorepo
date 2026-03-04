"""Deploy static sites and trigger application syncs.

Usage: uv run -m ci.deploy [--sites SITE ...]

Handles:
  1. S3 sync for static sites (sjer.red, webring, clauderon docs, resume)
  2. ArgoCD sync to roll out new images
  3. Cloudflare DNS updates (if needed)

Args:
  --sites: Only deploy specific sites (by bucket name, e.g. "sjer-red").
           If not specified, all sites are deployed.

Required env vars:
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY - SeaweedFS S3 credentials
  ARGOCD_TOKEN - ArgoCD API bearer token
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from ci.lib import argocd, s3
from ci.lib.config import ReleaseConfig


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


_REPO_ROOT = _repo_root()

# Unified site configuration: bucket_name -> (build_dir, build_cmd, dist_dir)
SITES = [
    {"bucket": "sjer-red", "build_dir": str(_REPO_ROOT / "packages/sjer.red"), "build_cmd": ["bun", "run", "astro", "build"], "dist_dir": str(_REPO_ROOT / "packages/sjer.red/dist")},
    {"bucket": "clauderon", "build_dir": str(_REPO_ROOT / "packages/clauderon/docs"), "build_cmd": ["bun", "run", "astro", "build"], "dist_dir": str(_REPO_ROOT / "packages/clauderon/docs/dist")},
    {"bucket": "resume", "build_dir": str(_REPO_ROOT / "packages/resume"), "build_cmd": None, "dist_dir": str(_REPO_ROOT / "packages/resume")},
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy static sites")
    parser.add_argument("--sites", nargs="+", default=None, help="Only deploy specific sites (by bucket name)")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping deploy", flush=True)
        return

    if args.sites:
        print(f"Filtering to sites: {', '.join(args.sites)}", flush=True)

    errors: list[str] = []

    # Filter sites by bucket name
    sites = SITES if not args.sites else [
        s for s in SITES if s["bucket"] in args.sites
    ]

    # --- Build static sites ---
    print("\n--- Build static sites ---", flush=True)
    # Install dependencies first
    subprocess.run(["bun", "install"], cwd=str(_REPO_ROOT), check=True)
    for site in sites:
        if site["build_cmd"] is None:
            print(f"\nSkipping build for {site['build_dir']} (static files)", flush=True)
            continue
        try:
            print(f"\nBuilding {site['build_dir']}", flush=True)
            subprocess.run(site["build_cmd"], cwd=site["build_dir"], check=True)
        except Exception as e:
            errors.append(f"Failed to build {site['build_dir']}: {e}")

    # --- S3 static site sync ---
    s3_key = os.environ.get("S3_ACCESS_KEY_ID", "")
    s3_secret = os.environ.get("S3_SECRET_ACCESS_KEY", "")
    if s3_key and s3_secret:
        print("\n--- Deploy static sites to S3 ---", flush=True)
        for bucket, local_dir in [(s["bucket"], s["dist_dir"]) for s in sites]:
            try:
                print(f"\nSyncing {bucket} from {local_dir}", flush=True)
                s3.sync(bucket, local_dir)
            except Exception as e:
                errors.append(f"Failed to sync {bucket}: {e}")
    else:
        print("S3 credentials not set, skipping static site deploy", flush=True)

    # --- ArgoCD sync ---
    argocd_token = os.environ.get("ARGOCD_TOKEN", "")
    if argocd_token:
        print("\n--- Trigger ArgoCD sync ---", flush=True)
        try:
            result = argocd.sync("apps", argocd_token)
            print(result, flush=True)
        except Exception as e:
            errors.append(f"ArgoCD sync failed: {e}")
    else:
        print("ARGOCD_TOKEN not set, skipping ArgoCD sync", flush=True)

    if errors:
        print(f"\n--- {len(errors)} error(s) during deploy ---", flush=True)
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}", flush=True)
        sys.exit(1)

    print("\nAll deployments completed successfully", flush=True)


if __name__ == "__main__":
    main()
