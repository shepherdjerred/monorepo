"""OpenTofu (Terraform) helpers for infrastructure stacks.

Ported from .dagger/src/index-release-helpers.ts runHomelabRelease().
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


_REPO_ROOT = _repo_root()

# argocd stack requires OP_CONNECT_TOKEN and argocd_admin_password (not available in CI)
TOFU_STACKS = ["cloudflare", "github", "seaweedfs"]


def _tofu_env() -> dict[str, str]:
    """Build env dict with CI env var mappings for tofu."""
    env = {**os.environ}
    # S3 backend credentials
    if "S3_ACCESS_KEY_ID" in env:
        env.setdefault("AWS_ACCESS_KEY_ID", env["S3_ACCESS_KEY_ID"])
    if "S3_SECRET_ACCESS_KEY" in env:
        env.setdefault("AWS_SECRET_ACCESS_KEY", env["S3_SECRET_ACCESS_KEY"])
    # TF_VAR_ mappings for tofu variables
    if "CLOUDFLARE_ACCOUNT_ID" in env:
        env.setdefault("TF_VAR_cloudflare_account_id", env["CLOUDFLARE_ACCOUNT_ID"])
    # GitHub provider token
    if "TOFU_GITHUB_TOKEN" in env:
        env.setdefault("GITHUB_TOKEN", env["TOFU_GITHUB_TOKEN"])
    return env


def init(stack_dir: str) -> None:
    """Run tofu init in the given directory."""
    cmd = ["tofu", "init", "-input=false"]
    print(f"+ {' '.join(cmd)} (in {stack_dir})", flush=True)
    subprocess.run(cmd, cwd=stack_dir, env=_tofu_env(), check=True)


def apply(stack_dir: str) -> str:
    """Run tofu apply -auto-approve in the given directory."""
    cmd = ["tofu", "apply", "-auto-approve", "-input=false"]
    print(f"+ {' '.join(cmd)} (in {stack_dir})", flush=True)
    result = subprocess.run(cmd, cwd=stack_dir, capture_output=True, text=True, env=_tofu_env())
    if result.returncode != 0:
        print(result.stdout, flush=True)
        print(result.stderr, flush=True)
        result.check_returncode()
    return result.stdout


def plan_and_apply(stack_name: str, base_dir: str | None = None) -> str:
    """Init and apply a single tofu stack."""
    if base_dir is None:
        base_dir = str(_REPO_ROOT / "packages/homelab/src/tofu")
    stack_dir = os.path.join(base_dir, stack_name)
    init(stack_dir)
    return apply(stack_dir)
