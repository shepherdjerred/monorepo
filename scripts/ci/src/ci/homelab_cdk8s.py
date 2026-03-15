"""Build cdk8s manifests for homelab infrastructure.

Usage: uv run -m ci.homelab_cdk8s
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from ci.lib.config import ReleaseConfig


def _repo_root() -> Path:
    """Get the git repository root directory."""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


def main() -> None:
    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping cdk8s build", flush=True)
        return

    repo_root = _repo_root()

    print("--- Installing dependencies ---", flush=True)
    subprocess.run(["bun", "install"], cwd=str(repo_root), check=True)

    print("--- Building cdk8s manifests ---", flush=True)
    subprocess.run(
        ["bun", "run", "build"],
        cwd=str(repo_root / "packages/homelab/src/cdk8s"),
        check=True,
    )

    print("cdk8s manifests built successfully", flush=True)


if __name__ == "__main__":
    main()
