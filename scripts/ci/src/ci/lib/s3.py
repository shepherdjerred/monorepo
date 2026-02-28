"""S3 sync helpers for SeaweedFS-compatible S3 endpoint.

Ported from .dagger/src/lib-s3.ts.
"""

from __future__ import annotations

import os
import subprocess

S3_ENDPOINT = "https://seaweedfs.sjer.red"


def sync(bucket: str, local_dir: str, *, delete: bool = True, prefix: str = "") -> None:
    """Sync a local directory to an S3 bucket.

    Args:
        bucket: S3 bucket name.
        local_dir: Local directory to sync from.
        delete: Whether to delete files in S3 that don't exist locally.
        prefix: Optional prefix/path within the bucket.
    """
    s3_path = f"s3://{bucket}/{prefix}" if prefix else f"s3://{bucket}/"
    env = {
        **os.environ,
        "AWS_ACCESS_KEY_ID": os.environ["S3_ACCESS_KEY_ID"],
        "AWS_SECRET_ACCESS_KEY": os.environ["S3_SECRET_ACCESS_KEY"],
        "AWS_DEFAULT_REGION": os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    }
    cmd = [
        "aws",
        "s3",
        "sync",
        local_dir,
        s3_path,
        "--endpoint-url",
        S3_ENDPOINT,
    ]
    if delete:
        cmd.append("--delete")
    print(f"+ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, env=env, check=True)
