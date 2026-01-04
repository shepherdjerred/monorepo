#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
# ]
# ///
"""
GitHub Repository Ruleset Manager

Applies a consistent set of rulesets across all your GitHub repositories.

Usage:
    uv run github-rulesets.py [--dry-run] [--apply] [--list]

Environment:
    GITHUB_TOKEN: Personal access token with repo permissions
"""

import os
import sys
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class RulesetConfig:
    """Configuration for a repository ruleset."""

    name: str
    target: str
    enforcement: str
    conditions: dict[str, Any]
    rules: list[dict[str, Any]]
    bypass_actors: list[dict[str, Any]] | None = None


# Standard ruleset configuration to apply to all repos
STANDARD_RULESET = RulesetConfig(
    name="main",
    target="branch",
    enforcement="active",
    conditions={"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
    rules=[
        {"type": "deletion"},
        {"type": "non_fast_forward"},
        {"type": "required_linear_history"},
        {
            "type": "required_status_checks",
            "parameters": {
                "required_status_checks": [{"context": "dagger-ci"}],
                "strict_required_status_checks_policy": False,
                "do_not_enforce_on_create": False,
            },
        },
    ],
    bypass_actors=[
        {
            "actor_id": 5,  # Repository admin role
            "actor_type": "RepositoryRole",
            "bypass_mode": "always",
        },
    ],
)

# Rulesets to delete if found
RULESETS_TO_DELETE = ["Require CI"]

# Standard repository settings to apply
# Set to None to leave unchanged
STANDARD_REPO_SETTINGS: dict[str, bool | str | None] = {
    # Features
    "has_issues": None,  # Leave unchanged
    "has_wiki": False,
    "has_projects": False,
    # Note: has_discussions requires separate API call, handled separately

    # Merge settings
    "allow_squash_merge": False,
    "allow_merge_commit": True,
    "allow_rebase_merge": True,
    "allow_auto_merge": True,
    "delete_branch_on_merge": True,
}


class GitHubClient:
    """Simple GitHub API client using httpx."""

    def __init__(self, token: str) -> None:
        self.client = httpx.Client(
            base_url="https://api.github.com",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=30.0,
        )

    def get_repos(self) -> list[dict[str, Any]]:
        """Get all repositories for the authenticated user."""
        repos: list[dict[str, Any]] = []
        page = 1
        while True:
            response = self.client.get(
                "/user/repos",
                params={"per_page": 100, "page": page, "affiliation": "owner"},
            )
            response.raise_for_status()
            data = response.json()
            if not data:
                break
            repos.extend(data)
            page += 1
        return repos

    def get_rulesets(self, owner: str, repo: str) -> list[dict[str, Any]]:
        """Get all rulesets for a repository."""
        response = self.client.get(f"/repos/{owner}/{repo}/rulesets")
        if response.status_code == 404:
            return []
        response.raise_for_status()
        return response.json()

    def get_ruleset(self, owner: str, repo: str, ruleset_id: int) -> dict[str, Any]:
        """Get a specific ruleset by ID."""
        response = self.client.get(f"/repos/{owner}/{repo}/rulesets/{ruleset_id}")
        response.raise_for_status()
        return response.json()

    def create_ruleset(
        self, owner: str, repo: str, config: RulesetConfig
    ) -> dict[str, Any]:
        """Create a new ruleset."""
        payload = {
            "name": config.name,
            "target": config.target,
            "enforcement": config.enforcement,
            "conditions": config.conditions,
            "rules": config.rules,
        }
        if config.bypass_actors:
            payload["bypass_actors"] = config.bypass_actors

        response = self.client.post(f"/repos/{owner}/{repo}/rulesets", json=payload)
        response.raise_for_status()
        return response.json()

    def update_ruleset(
        self, owner: str, repo: str, ruleset_id: int, config: RulesetConfig
    ) -> dict[str, Any]:
        """Update an existing ruleset."""
        payload = {
            "name": config.name,
            "target": config.target,
            "enforcement": config.enforcement,
            "conditions": config.conditions,
            "rules": config.rules,
        }
        if config.bypass_actors:
            payload["bypass_actors"] = config.bypass_actors

        response = self.client.put(
            f"/repos/{owner}/{repo}/rulesets/{ruleset_id}", json=payload
        )
        response.raise_for_status()
        return response.json()

    def delete_ruleset(self, owner: str, repo: str, ruleset_id: int) -> None:
        """Delete a ruleset."""
        response = self.client.delete(f"/repos/{owner}/{repo}/rulesets/{ruleset_id}")
        response.raise_for_status()

    def get_repo(self, owner: str, repo: str) -> dict[str, Any]:
        """Get repository details."""
        response = self.client.get(f"/repos/{owner}/{repo}")
        response.raise_for_status()
        return response.json()

    def update_repo(self, owner: str, repo: str, settings: dict[str, Any]) -> dict[str, Any]:
        """Update repository settings."""
        response = self.client.patch(f"/repos/{owner}/{repo}", json=settings)
        response.raise_for_status()
        return response.json()

    def disable_discussions(self, owner: str, repo: str) -> None:
        """Disable discussions for a repository (requires GraphQL)."""
        # Note: This requires the GraphQL API, skipping for now
        pass


def normalize_rules(rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize rules for comparison by sorting and removing metadata."""
    normalized = []
    for rule in rules:
        norm_rule: dict[str, Any] = {"type": rule["type"]}
        if "parameters" in rule:
            norm_rule["parameters"] = rule["parameters"]
        normalized.append(norm_rule)
    return sorted(normalized, key=lambda r: r["type"])


def normalize_bypass_actors(actors: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Normalize bypass actors for comparison."""
    if not actors:
        return []
    normalized = []
    for actor in actors:
        normalized.append({
            "actor_id": actor.get("actor_id"),
            "actor_type": actor.get("actor_type"),
            "bypass_mode": actor.get("bypass_mode"),
        })
    return sorted(normalized, key=lambda a: (a["actor_type"], a["actor_id"]))


def rulesets_match(existing: dict[str, Any], config: RulesetConfig) -> bool:
    """Check if an existing ruleset matches the desired configuration."""
    if existing.get("enforcement") != config.enforcement:
        return False
    if existing.get("conditions") != config.conditions:
        return False
    if normalize_rules(existing.get("rules", [])) != normalize_rules(config.rules):
        return False
    if normalize_bypass_actors(existing.get("bypass_actors")) != normalize_bypass_actors(config.bypass_actors):
        return False
    return True


def list_rulesets(client: GitHubClient) -> None:
    """List all rulesets across all repositories."""
    repos = client.get_repos()
    print(f"Found {len(repos)} repositories\n")

    for repo in sorted(repos, key=lambda r: r["full_name"]):
        full_name: str = repo["full_name"]
        owner, name = full_name.split("/")
        rulesets = client.get_rulesets(owner, name)

        if rulesets:
            print(f"{full_name}:")
            for rs in rulesets:
                detail = client.get_ruleset(owner, name, rs["id"])
                rule_types = [r["type"] for r in detail.get("rules", [])]
                print(f"  - {rs['name']} ({rs['enforcement']}): {', '.join(rule_types)}")
        else:
            print(f"{full_name}: (no rulesets)")
    print()


def get_repo_settings_diff(
    current: dict[str, Any], desired: dict[str, bool | str | None]
) -> dict[str, Any]:
    """Get settings that need to be changed."""
    diff: dict[str, Any] = {}
    for key, value in desired.items():
        if value is None:
            continue  # Skip settings we don't want to change
        if current.get(key) != value:
            diff[key] = value
    return diff


def apply_rulesets(client: GitHubClient, dry_run: bool = True) -> None:
    """Apply the standard ruleset and repo settings to all repositories."""
    repos = client.get_repos()
    print(f"Found {len(repos)} repositories")
    print(f"Mode: {'DRY RUN' if dry_run else 'APPLY'}\n")

    for repo in sorted(repos, key=lambda r: r["full_name"]):
        full_name: str = repo["full_name"]
        owner, name = full_name.split("/")

        # Skip archived repos
        if repo.get("archived"):
            print(f"[SKIP] {full_name} (archived)")
            continue

        # === REPO SETTINGS ===
        repo_details = client.get_repo(owner, name)
        settings_diff = get_repo_settings_diff(repo_details, STANDARD_REPO_SETTINGS)

        if settings_diff:
            changes = ", ".join(f"{k}={v}" for k, v in settings_diff.items())
            print(f"[SET]  {full_name} (updating: {changes})")
            if not dry_run:
                client.update_repo(owner, name, settings_diff)
        else:
            print(f"[OK]   {full_name} (repo settings match)")

        # === RULESETS ===
        rulesets = client.get_rulesets(owner, name)

        # Delete unwanted rulesets
        for rs in rulesets:
            if rs["name"] in RULESETS_TO_DELETE:
                print(f"[DEL]  {full_name} (deleting '{rs['name']}' ruleset)")
                if not dry_run:
                    client.delete_ruleset(owner, name, rs["id"])

        # Apply standard ruleset
        existing = next(
            (rs for rs in rulesets if rs["name"] == STANDARD_RULESET.name), None
        )

        if existing:
            detail = client.get_ruleset(owner, name, existing["id"])
            if rulesets_match(detail, STANDARD_RULESET):
                print(f"[OK]   {full_name} (ruleset matches)")
            else:
                print(f"[UPD]  {full_name} (updating ruleset)")
                if not dry_run:
                    client.update_ruleset(owner, name, existing["id"], STANDARD_RULESET)
        else:
            print(f"[NEW]  {full_name} (creating ruleset)")
            if not dry_run:
                client.create_ruleset(owner, name, STANDARD_RULESET)

    print()
    if dry_run:
        print("Dry run complete. Use --apply to make changes.")


def main() -> None:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("Error: GITHUB_TOKEN environment variable is required")
        print("Create one at: https://github.com/settings/tokens")
        print("Required scopes: repo")
        sys.exit(1)

    args = sys.argv[1:]

    if "--help" in args or "-h" in args:
        print(__doc__)
        sys.exit(0)

    client = GitHubClient(token)

    if "--list" in args:
        list_rulesets(client)
    elif "--apply" in args:
        apply_rulesets(client, dry_run=False)
    else:
        # Default to dry-run
        apply_rulesets(client, dry_run=True)


if __name__ == "__main__":
    main()
