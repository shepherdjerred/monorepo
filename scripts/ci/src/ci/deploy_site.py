"""Build and deploy one static site.

Usage: uv run -m ci.deploy_site --bucket sjer-red --build-dir packages/sjer.red \
       --build-cmd "bun run astro build" --dist-dir packages/sjer.red/dist \
       [--needs-playwright] [--target s3|r2] [--workspace-deps dep1,dep2]

Required env vars:
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY - SeaweedFS S3 credentials (for s3 target)
  CF_ACCOUNT_ID, CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY - Cloudflare R2 (for r2 target)
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from ci.lib import r2, s3
from ci.lib.config import ReleaseConfig


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and deploy one static site")
    parser.add_argument("--bucket", required=True, help="Target bucket name")
    parser.add_argument("--build-dir", required=True, help="Build directory relative to repo root")
    parser.add_argument("--build-cmd", default="none", help='Build command (space-separated), or "none" to skip')
    parser.add_argument("--dist-dir", required=True, help="Dist directory relative to repo root")
    parser.add_argument("--needs-playwright", action="store_true", help="Install Playwright chromium before build")
    parser.add_argument("--target", choices=["s3", "r2"], default="s3", help="Deploy target (default: s3)")
    parser.add_argument("--workspace-deps", default=None, help="Comma-separated list of workspace packages to build first")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping deploy", flush=True)
        return

    # Validate credentials
    if args.target == "r2":
        required_vars = ["CF_ACCOUNT_ID", "CF_R2_ACCESS_KEY_ID", "CF_R2_SECRET_ACCESS_KEY"]
    else:
        required_vars = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]
    missing = [v for v in required_vars if not os.environ.get(v)]
    if missing:
        print(f"Missing required env vars: {', '.join(missing)}", flush=True)
        sys.exit(1)

    repo_root = _repo_root()
    full_build_dir = repo_root / args.build_dir
    full_dist_dir = repo_root / args.dist_dir

    # Install dependencies
    print("Installing dependencies", flush=True)
    subprocess.run(["bun", "install"], cwd=str(repo_root), check=True)

    # Build workspace dependencies
    if args.workspace_deps:
        for dep in args.workspace_deps.split(","):
            dep = dep.strip()
            print(f"\nBuilding workspace dependency: {dep}", flush=True)
            subprocess.run(["bun", "run", "build"], cwd=str(repo_root / f"packages/{dep}"), check=True)

    # Install Playwright if needed
    if args.needs_playwright:
        print("\nInstalling Playwright chromium", flush=True)
        subprocess.run(["bunx", "playwright", "install", "--with-deps", "chromium"], check=True)

    # Build
    if args.build_cmd.lower() != "none":
        build_cmd_parts = args.build_cmd.split()
        print(f"\nBuilding {full_build_dir}", flush=True)
        subprocess.run(build_cmd_parts, cwd=str(full_build_dir), check=True)
    else:
        print(f"\nSkipping build for {full_build_dir} (static files)", flush=True)

    # Deploy
    print(f"\nSyncing {args.bucket} from {full_dist_dir}", flush=True)
    if args.target == "r2":
        r2.sync(args.bucket, str(full_dist_dir))
    else:
        s3.sync(args.bucket, str(full_dist_dir))

    print(f"\nSuccessfully deployed {args.bucket}", flush=True)


if __name__ == "__main__":
    main()
