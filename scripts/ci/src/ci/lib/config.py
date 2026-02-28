from __future__ import annotations

import os
from dataclasses import dataclass


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
