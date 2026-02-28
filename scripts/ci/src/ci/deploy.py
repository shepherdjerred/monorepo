"""Deploy static sites and trigger application syncs.

Usage: uv run -m ci.deploy

Handles:
  1. S3 sync for static sites (sjer.red, webring, clauderon docs, resume)
  2. ArgoCD sync to roll out new images
  3. Cloudflare DNS updates (if needed)

Required env vars:
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY - SeaweedFS S3 credentials
  ARGOCD_TOKEN - ArgoCD API bearer token
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH
"""

from __future__ import annotations

import os
import subprocess
import sys

from ci.lib import argocd, s3
from ci.lib.config import ReleaseConfig

# Sites to build before deploying
SITE_BUILDS = [
    {"dir": "packages/sjer.red", "cmd": ["bunx", "astro", "build"]},
    {"dir": "packages/webring", "cmd": ["bunx", "astro", "build"]},
    {"dir": "packages/clauderon/docs", "cmd": ["bunx", "astro", "build"]},
    {"dir": "packages/resume", "cmd": ["bun", "run", "build"]},
]

# Static site deployments: (bucket_name, workspace_dir)
STATIC_SITES = [
    ("sjer-red", "packages/sjer.red/dist"),
    ("webring", "packages/webring/dist"),
    ("clauderon-docs", "packages/clauderon/docs/dist"),
    ("resume", "packages/resume/dist"),
]


def main() -> None:
    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping deploy", flush=True)
        return

    errors: list[str] = []

    # --- Build static sites ---
    print("\n--- Build static sites ---", flush=True)
    # Install dependencies first
    subprocess.run(["bun", "install"], check=True)
    for site in SITE_BUILDS:
        try:
            print(f"\nBuilding {site['dir']}", flush=True)
            subprocess.run(site["cmd"], cwd=site["dir"], check=True)
        except Exception as e:
            errors.append(f"Failed to build {site['dir']}: {e}")

    # --- S3 static site sync ---
    s3_key = os.environ.get("S3_ACCESS_KEY_ID", "")
    s3_secret = os.environ.get("S3_SECRET_ACCESS_KEY", "")
    if s3_key and s3_secret:
        print("\n--- Deploy static sites to S3 ---", flush=True)
        for bucket, local_dir in STATIC_SITES:
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
