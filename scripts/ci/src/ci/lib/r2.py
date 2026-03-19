"""R2 sync helper for Cloudflare R2 S3-compatible endpoint."""

from __future__ import annotations

import os

from ci.lib import runner


def sync(
    bucket: str,
    local_dir: str,
    *,
    delete: bool = True,
    dry_run: bool = False,
) -> None:
    """Sync a local directory to a Cloudflare R2 bucket.

    Args:
        bucket: R2 bucket name.
        local_dir: Local directory to sync from.
        delete: Whether to delete files in R2 that don't exist locally.
        dry_run: If True, print what would be done without executing.
    """
    account_id = os.environ.get("CF_ACCOUNT_ID", "")
    endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
    s3_path = f"s3://{bucket}/"
    env = {
        **os.environ,
        "AWS_ACCESS_KEY_ID": os.environ.get("CF_R2_ACCESS_KEY_ID", ""),
        "AWS_SECRET_ACCESS_KEY": os.environ.get("CF_R2_SECRET_ACCESS_KEY", ""),
        "AWS_DEFAULT_REGION": "auto",
    }
    cmd = [
        "aws",
        "s3",
        "sync",
        local_dir,
        s3_path,
        "--endpoint-url",
        endpoint_url,
    ]
    if delete:
        cmd.append("--delete")
    runner.run(cmd, env=env, dry_run=dry_run)
