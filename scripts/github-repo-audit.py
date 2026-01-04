#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
GitHub Repository Settings Audit

Audits all repository settings using gh CLI with generous retries.

Usage:
    uv run github-repo-audit.py

Requirements:
    gh CLI installed and authenticated
"""

import json
import subprocess
import sys
import time
from typing import Any


def run_gh(args: list[str], max_retries: int = 20, retry_delay: float = 3.0) -> str:
    """Run gh command with generous retries."""
    cmd = ["gh"] + args
    last_error: str = ""

    for attempt in range(1, max_retries + 1):
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode == 0:
                return result.stdout
            last_error = result.stderr
            if "connection refused" in last_error.lower() or "timeout" in last_error.lower():
                print(f"  Retry {attempt}/{max_retries}...", file=sys.stderr)
                time.sleep(retry_delay)
                continue
            # Non-retryable error
            raise RuntimeError(f"gh command failed: {last_error}")
        except subprocess.TimeoutExpired:
            print(f"  Timeout, retry {attempt}/{max_retries}...", file=sys.stderr)
            time.sleep(retry_delay)
            last_error = "timeout"

    raise RuntimeError(f"Failed after {max_retries} attempts: {last_error}")


def get_repo_list() -> list[str]:
    """Get list of owned repositories."""
    output = run_gh([
        "repo", "list",
        "--json", "nameWithOwner",
        "--jq", ".[].nameWithOwner",
        "--limit", "500",
    ])
    return [line.strip() for line in output.strip().split("\n") if line.strip()]


def get_repo_settings(repo: str) -> dict[str, Any]:
    """Get settings for a specific repository."""
    output = run_gh(["api", f"repos/{repo}"])
    data = json.loads(output)
    return {
        "name": data.get("name"),
        "default_branch": data.get("default_branch"),
        "has_issues": data.get("has_issues"),
        "has_wiki": data.get("has_wiki"),
        "has_projects": data.get("has_projects"),
        "has_discussions": data.get("has_discussions"),
        "delete_branch_on_merge": data.get("delete_branch_on_merge"),
        "allow_squash_merge": data.get("allow_squash_merge"),
        "allow_merge_commit": data.get("allow_merge_commit"),
        "allow_rebase_merge": data.get("allow_rebase_merge"),
        "allow_auto_merge": data.get("allow_auto_merge"),
        "squash_merge_commit_title": data.get("squash_merge_commit_title"),
        "squash_merge_commit_message": data.get("squash_merge_commit_message"),
    }


def main() -> None:
    print("Fetching repository list...")
    repos = get_repo_list()
    print(f"Found {len(repos)} repositories\n")

    # Collect settings
    all_settings: list[dict[str, Any]] = []
    for i, repo in enumerate(sorted(repos), 1):
        print(f"[{i}/{len(repos)}] Fetching {repo}...")
        try:
            settings = get_repo_settings(repo)
            settings["repo"] = repo
            all_settings.append(settings)
        except RuntimeError as e:
            print(f"  ERROR: {e}", file=sys.stderr)
            all_settings.append({"repo": repo, "error": str(e)})

    # Print results
    print("\n" + "=" * 100)
    print("REPOSITORY SETTINGS AUDIT")
    print("=" * 100 + "\n")

    # Headers
    headers = ["REPO", "BRANCH", "ISSUES", "WIKI", "PROJECTS", "DISCUSS", "DEL_BR", "SQUASH", "MERGE", "REBASE", "AUTO"]

    # Build rows
    rows: list[list[str]] = []
    for s in all_settings:
        if "error" in s:
            rows.append([s["repo"], "ERROR", "", "", "", "", "", "", "", "", ""])
        else:
            rows.append([
                s.get("name", ""),
                s.get("default_branch", ""),
                "Y" if s.get("has_issues") else "N",
                "Y" if s.get("has_wiki") else "N",
                "Y" if s.get("has_projects") else "N",
                "Y" if s.get("has_discussions") else "N",
                "Y" if s.get("delete_branch_on_merge") else "N",
                "Y" if s.get("allow_squash_merge") else "N",
                "Y" if s.get("allow_merge_commit") else "N",
                "Y" if s.get("allow_rebase_merge") else "N",
                "Y" if s.get("allow_auto_merge") else "N",
            ])

    # Calculate column widths
    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            col_widths[i] = max(col_widths[i], len(cell))

    # Print table
    header_line = " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    print(header_line)
    print("-" * len(header_line))
    for row in rows:
        print(" | ".join(cell.ljust(col_widths[i]) for i, cell in enumerate(row)))

    # Find and report differences
    print("\n" + "=" * 100)
    print("SETTINGS DIFFERENCES")
    print("=" * 100 + "\n")

    bool_settings = [
        ("has_issues", "Issues"),
        ("has_wiki", "Wiki"),
        ("has_projects", "Projects"),
        ("has_discussions", "Discussions"),
        ("delete_branch_on_merge", "Delete branch on merge"),
        ("allow_squash_merge", "Allow squash merge"),
        ("allow_merge_commit", "Allow merge commit"),
        ("allow_rebase_merge", "Allow rebase merge"),
        ("allow_auto_merge", "Allow auto merge"),
    ]

    valid_settings = [s for s in all_settings if "error" not in s]

    for key, label in bool_settings:
        values = {s.get(key) for s in valid_settings}
        if len(values) > 1:
            true_repos = [s["name"] for s in valid_settings if s.get(key)]
            false_repos = [s["name"] for s in valid_settings if not s.get(key)]
            print(f"{label}:")
            print(f"  Enabled  ({len(true_repos):2d}): {', '.join(sorted(true_repos))}")
            print(f"  Disabled ({len(false_repos):2d}): {', '.join(sorted(false_repos))}")
            print()


if __name__ == "__main__":
    main()
