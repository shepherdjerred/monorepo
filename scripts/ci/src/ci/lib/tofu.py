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

TOFU_STACKS = ["argocd", "cloudflare", "github", "seaweedfs"]


def init(stack_dir: str) -> None:
    """Run tofu init in the given directory."""
    cmd = ["tofu", "init", "-input=false"]
    print(f"+ {' '.join(cmd)} (in {stack_dir})", flush=True)
    subprocess.run(cmd, cwd=stack_dir, check=True)


def apply(stack_dir: str) -> str:
    """Run tofu apply -auto-approve in the given directory."""
    cmd = ["tofu", "apply", "-auto-approve", "-input=false"]
    print(f"+ {' '.join(cmd)} (in {stack_dir})", flush=True)
    result = subprocess.run(cmd, cwd=stack_dir, capture_output=True, text=True, check=True)
    return result.stdout


def plan_and_apply(stack_name: str, base_dir: str | None = None) -> str:
    """Init and apply a single tofu stack."""
    if base_dir is None:
        base_dir = str(_REPO_ROOT / "packages/homelab/src/tofu")
    stack_dir = os.path.join(base_dir, stack_name)
    init(stack_dir)
    return apply(stack_dir)
