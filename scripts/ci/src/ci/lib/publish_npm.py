"""NPM publish helpers.

Ported from .dagger/src/lib-npm.ts.
"""

from __future__ import annotations

import os
from pathlib import Path

from ci.lib import runner


def publish(
    package_dir: str,
    token: str,
    *,
    access: str = "public",
    tag: str = "latest",
    registry: str = "https://registry.npmjs.org",
    dry_run: bool = False,
) -> str:
    """Publish a package to NPM using bun publish.

    Args:
        package_dir: Path to the package directory.
        token: NPM authentication token.
        access: Access level for scoped packages ("public" or "restricted").
        tag: Distribution tag (default: "latest").
        registry: NPM registry URL.
        dry_run: If True, print what would be done without executing.

    Returns:
        Stdout from the publish command.
    """
    if not dry_run:
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
    result = runner.run(
        cmd,
        cwd=package_dir,
        env={**os.environ, "NPM_TOKEN": token} if not dry_run else None,
        capture_output=True,
        dry_run=dry_run,
        dry_run_stdout=f"Published {package_dir} (dry-run)",
    )
    return result.stdout
