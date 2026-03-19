"""Apply one OpenTofu stack for homelab infrastructure.

Usage: uv run -m ci.homelab_tofu_stack --stack cloudflare

Required env vars:
  TOFU_GITHUB_TOKEN - GitHub token for OpenTofu stacks
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH, BUILDKITE_COMMIT
"""

from __future__ import annotations

import argparse
import os

from ci.lib import tofu
from ci.lib.catalog import TOFU_STACKS
from ci.lib.config import ReleaseConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply one OpenTofu stack")
    parser.add_argument("--stack", required=True, choices=TOFU_STACKS, help="Stack name to apply")
    args = parser.parse_args()

    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping OpenTofu apply", flush=True)
        return

    tofu_github_token = os.environ.get("TOFU_GITHUB_TOKEN", "")
    if not tofu_github_token:
        print("TOFU_GITHUB_TOKEN not set, skipping OpenTofu apply", flush=True)
        return

    print(f"--- Applying OpenTofu stack: {args.stack} ---", flush=True)
    result = tofu.plan_and_apply(args.stack)
    print(result[:500], flush=True)

    print(f"\nOpenTofu stack '{args.stack}' applied successfully", flush=True)


if __name__ == "__main__":
    main()
