"""NPM publish helpers.

Ported from .dagger/src/lib-npm.ts.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def publish(
    package_dir: str,
    token: str,
    *,
    access: str = "public",
    tag: str = "latest",
    registry: str = "https://registry.npmjs.org",
) -> str:
    """Publish a package to NPM using bun publish.

    Args:
        package_dir: Path to the package directory.
        token: NPM authentication token.
        access: Access level for scoped packages ("public" or "restricted").
        tag: Distribution tag (default: "latest").
        registry: NPM registry URL.

    Returns:
        Stdout from the publish command.
    """
    # Write .npmrc with auth token
    npmrc_path = Path.home() / ".npmrc"
    registry_host = registry.replace("https://", "").replace("http://", "").rstrip("/")
    npmrc_path.write_text(f"//{registry_host}/:_authToken={token}\n")

    cmd = [
        "bun",
        "publish",
        "--access",
        access,
        "--tag",
        tag,
        "--registry",
        registry,
    ]
    print(f"+ {' '.join(cmd)}", flush=True)
    result = subprocess.run(
        cmd,
        cwd=package_dir,
        env={**os.environ, "NPM_TOKEN": token},
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout
