"""GHCR (GitHub Container Registry) helpers.

Ported from .dagger/src/lib-ghcr.ts.
"""

from __future__ import annotations

import base64
import json
import os
import re


def login(token: str) -> None:
    """Authenticate with ghcr.io by writing ~/.docker/config.json.

    This avoids requiring the Docker CLI — crane (used by oci_push) and
    other container tools read the same config file.
    """
    config_dir = os.path.expanduser("~/.docker")
    os.makedirs(config_dir, exist_ok=True)
    auth = base64.b64encode(f"github:{token}".encode()).decode()
    config_path = os.path.join(config_dir, "config.json")
    config: dict = {}
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)
    config.setdefault("auths", {})["ghcr.io"] = {"auth": auth}
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)


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
