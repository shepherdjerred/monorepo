"""GHCR (GitHub Container Registry) helpers.

Ported from .dagger/src/lib-ghcr.ts.
"""

from __future__ import annotations

import re
import subprocess


def login(username: str, password: str) -> None:
    """Authenticate with ghcr.io using docker login."""
    subprocess.run(
        ["docker", "login", "ghcr.io", "-u", username, "--password-stdin"],
        input=password,
        text=True,
        check=True,
    )


def extract_digest_from_ref(publish_ref: str) -> str | None:
    """Extract the sha256 digest from a container publish reference.

    E.g. "ghcr.io/owner/repo:tag@sha256:abc123..." -> "sha256:abc123..."
    """
    match = re.search(r"@(sha256:[a-f0-9]+)", publish_ref)
    return match.group(1) if match else None


def format_version_with_digest(version: str, publish_ref: str) -> str:
    """Combine a human-readable version with a digest from a publish ref.

    E.g. ("1.0.1791", "ghcr.io/.../repo:tag@sha256:abc...") -> "1.0.1791@sha256:abc..."
    Falls back to plain version if no digest found.
    """
    digest = extract_digest_from_ref(publish_ref)
    if digest is None:
        return version
    return f"{version}@{digest}"
