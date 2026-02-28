"""GitHub API helpers.

Ported from .dagger/src/lib-github.ts.
"""

from __future__ import annotations

import httpx

GITHUB_API = "https://api.github.com"
REPO = "shepherdjerred/monorepo"


def create_tag(tag: str, sha: str, token: str, *, repo: str = REPO) -> str:
    """Create a lightweight git tag via the GitHub API.

    Args:
        tag: Tag name (e.g. "v1.0.0").
        sha: Full commit SHA to tag.
        token: GitHub personal access token or app token.
        repo: Repository in "owner/repo" format.

    Returns:
        Status message.
    """
    headers = _headers(token)
    response = httpx.post(
        f"{GITHUB_API}/repos/{repo}/git/refs",
        json={"ref": f"refs/tags/{tag}", "sha": sha},
        headers=headers,
        timeout=30,
    )
    # 422 means tag already exists
    if response.status_code == 422:
        return f"Tag {tag} already exists"
    response.raise_for_status()
    return f"Created tag {tag} at {sha[:8]}"


def create_release(tag: str, token: str, *, repo: str = REPO, auto_notes: bool = True) -> str:
    """Create a GitHub release for the given tag.

    Args:
        tag: Tag name (e.g. "v1.0.0").
        token: GitHub personal access token or app token.
        repo: Repository in "owner/repo" format.
        auto_notes: Whether to auto-generate release notes.

    Returns:
        The release HTML URL.
    """
    headers = _headers(token)
    response = httpx.post(
        f"{GITHUB_API}/repos/{repo}/releases",
        json={
            "tag_name": tag,
            "name": tag,
            "generate_release_notes": auto_notes,
        },
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    return response.json().get("html_url", f"Release created for {tag}")


def commit_file(
    path: str,
    content: str,
    message: str,
    token: str,
    *,
    repo: str = REPO,
    branch: str = "main",
) -> str:
    """Create or update a file in the repository via the GitHub API.

    Args:
        path: File path within the repository.
        content: File content (will be base64-encoded).
        message: Commit message.
        token: GitHub personal access token or app token.
        repo: Repository in "owner/repo" format.
        branch: Target branch.

    Returns:
        Status message.
    """
    import base64

    headers = _headers(token)

    # Check if file exists to get its SHA
    existing_sha: str | None = None
    get_response = httpx.get(
        f"{GITHUB_API}/repos/{repo}/contents/{path}",
        params={"ref": branch},
        headers=headers,
        timeout=30,
    )
    if get_response.status_code == 200:
        existing_sha = get_response.json().get("sha")

    payload: dict[str, str | None] = {
        "message": message,
        "content": base64.b64encode(content.encode()).decode(),
        "branch": branch,
    }
    if existing_sha:
        payload["sha"] = existing_sha

    response = httpx.put(
        f"{GITHUB_API}/repos/{repo}/contents/{path}",
        json=payload,
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    return f"Committed {path} to {branch}"


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
