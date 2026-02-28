"""Run AI-powered code review on a pull request.

Usage: uv run -m ci.code_review

Wraps the existing code-review shell script or invokes claude-code directly
for PR review.

Required env vars:
  GH_TOKEN - GitHub token for PR access
  CLAUDE_CODE_OAUTH_TOKEN - Claude Code OAuth token
  BUILDKITE_PULL_REQUEST - PR number
  BUILDKITE_PULL_REQUEST_BASE_BRANCH - Base branch
  BUILDKITE_COMMIT - Head commit SHA
"""

from __future__ import annotations

import os
import subprocess
import sys


def main() -> None:
    pr_number = os.environ.get("BUILDKITE_PULL_REQUEST", "")
    if not pr_number or pr_number == "false":
        print("Not a pull request build, skipping code review", flush=True)
        return

    gh_token = os.environ.get("GH_TOKEN", "")
    claude_token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "")
    base_branch = os.environ.get("BUILDKITE_PULL_REQUEST_BASE_BRANCH", "main")
    head_sha = os.environ.get("BUILDKITE_COMMIT", "HEAD")

    if not gh_token or not claude_token:
        print("Missing GH_TOKEN or CLAUDE_CODE_OAUTH_TOKEN, skipping code review", flush=True)
        return

    print(f"Running code review for PR #{pr_number} (base={base_branch}, head={head_sha[:8]})", flush=True)

    # Use claude CLI for code review
    cmd = [
        "claude",
        "--print",
        f"Review PR #{pr_number}. Base branch: {base_branch}, head SHA: {head_sha}. "
        "Focus on: correctness, security, performance, and code quality. "
        "Post review comments via the GitHub API.",
    ]

    env = {
        **os.environ,
        "GH_TOKEN": gh_token,
        "CLAUDE_CODE_OAUTH_TOKEN": claude_token,
    }

    result = subprocess.run(cmd, env=env, check=False)
    if result.returncode != 0:
        print(f"Code review exited with code {result.returncode}", flush=True)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
