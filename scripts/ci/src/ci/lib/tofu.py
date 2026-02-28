"""OpenTofu (Terraform) helpers for infrastructure stacks.

Ported from .dagger/src/index-release-helpers.ts runHomelabRelease().
"""

from __future__ import annotations

import os
import subprocess

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


def plan_and_apply(stack_name: str, base_dir: str = "packages/homelab/src/tofu") -> str:
    """Init and apply a single tofu stack."""
    stack_dir = os.path.join(base_dir, stack_name)
    init(stack_dir)
    return apply(stack_dir)
