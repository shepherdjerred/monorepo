"""Create git tags and GitHub releases.

Usage: uv run -m ci.tag_release

Creates a git tag (v{version}) and a GitHub release with auto-generated notes.

Required env vars:
  GH_TOKEN - GitHub personal access token
  BUILDKITE_BUILD_NUMBER, BUILDKITE_BRANCH, BUILDKITE_COMMIT
"""

from __future__ import annotations

import os
import sys

from ci.lib import github
from ci.lib.config import ReleaseConfig


def main() -> None:
    config = ReleaseConfig.from_env()
    if not config.is_release:
        print("Not on main branch, skipping tag/release", flush=True)
        return

    gh_token = os.environ.get("GH_TOKEN", "")
    if not gh_token:
        print("GH_TOKEN not set, skipping tag/release", flush=True)
        return

    tag = f"v{config.version}"
    print(f"Creating tag {tag} at {config.git_sha[:8]}", flush=True)

    try:
        result = github.create_tag(tag, config.git_sha, gh_token)
        print(result, flush=True)
    except Exception as e:
        print(f"Tag creation failed: {e}", flush=True)
        sys.exit(1)

    print(f"Creating GitHub release for {tag}", flush=True)
    try:
        release_url = github.create_release(tag, gh_token)
        print(f"Release created: {release_url}", flush=True)
    except Exception as e:
        print(f"Release creation failed: {e}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
