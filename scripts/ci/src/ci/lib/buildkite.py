"""Buildkite agent helpers for cross-step metadata sharing and annotations."""

from __future__ import annotations

import shutil
import subprocess


def get_metadata(key: str, default: str = "") -> str:
    """Get Buildkite metadata. Returns default if buildkite-agent is not available."""
    if shutil.which("buildkite-agent") is None:
        return default
    result = subprocess.run(
        ["buildkite-agent", "meta-data", "get", key, "--default", default],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else default


def set_metadata(key: str, value: str) -> None:
    """Set Buildkite metadata. No-op if buildkite-agent is not available.

    Raises subprocess.CalledProcessError if the write fails.
    """
    if shutil.which("buildkite-agent") is None:
        print(f"buildkite-agent not found, skipping meta-data set {key}", flush=True)
        return
    subprocess.run(
        ["buildkite-agent", "meta-data", "set", key, value],
        check=True,
    )


def annotate(message: str, *, style: str = "error", context: str = "default") -> None:
    """Create a Buildkite annotation. No-op if buildkite-agent is not available."""
    if shutil.which("buildkite-agent") is None:
        return
    subprocess.run(
        ["buildkite-agent", "annotate", message, "--style", style, "--context", context],
        check=False,
    )
