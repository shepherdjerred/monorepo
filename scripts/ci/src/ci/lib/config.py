from __future__ import annotations

import datetime
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

_VERSIONS_TS = "packages/homelab/src/cdk8s/src/versions.ts"
# Match CI-managed custom images: key on one line, "1.1.X@sha..." on next line
_CI_VERSION_RE = re.compile(r'"shepherdjerred/[^"]+":\s*\n\s*"1\.1\.(\d+)')


def _next_local_patch() -> int:
    """Parse versions.ts for the highest 1.1.x patch and return max+1.

    Falls back to 0 if versions.ts cannot be read or has no matching versions.
    """
    try:
        repo_root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        content = (Path(repo_root) / _VERSIONS_TS).read_text()
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return 0
    patches = [int(m.group(1)) for m in _CI_VERSION_RE.finditer(content)]
    return max(patches, default=0) + 1


@dataclass(frozen=True)
class ReleaseConfig:
    """Release configuration derived from Buildkite environment variables.

    Version format: "1.1.{BUILDKITE_BUILD_NUMBER}"
    """

    version: str
    git_sha: str
    branch: str
    build_number: int
    is_release: bool

    @classmethod
    def from_env(cls) -> ReleaseConfig:
        build_number = int(os.environ.get("BUILDKITE_BUILD_NUMBER", "0"))
        branch = os.environ.get("BUILDKITE_BRANCH", "unknown")
        git_sha = os.environ.get("BUILDKITE_COMMIT", "unknown")
        version = f"1.1.{build_number}"
        return cls(
            version=version,
            git_sha=git_sha,
            branch=branch,
            build_number=build_number,
            is_release=branch == "main",
        )

    @classmethod
    def for_local(cls, *, version: str | None = None) -> ReleaseConfig:
        """Create config for local CLI runs.

        Auto-generates a prerelease version by finding the highest 1.1.x patch
        in versions.ts and emitting 1.1.<max+1>-local.<timestamp>.
        """
        if version is None:
            ts = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
            next_patch = _next_local_patch()
            version = f"1.1.{next_patch}-local.{ts}"
        v = version
        git_sha = (
            subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True,
                text=True,
                check=False,
            ).stdout.strip()
            or "unknown"
        )
        branch = (
            subprocess.run(
                ["git", "branch", "--show-current"],
                capture_output=True,
                text=True,
                check=False,
            ).stdout.strip()
            or "unknown"
        )
        return cls(
            version=v,
            git_sha=git_sha,
            branch=branch,
            build_number=0,
            is_release=False,
        )
