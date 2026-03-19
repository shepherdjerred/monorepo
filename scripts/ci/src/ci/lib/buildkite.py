"""Buildkite agent helpers for cross-step metadata sharing and annotations."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _run_dir() -> Path:
    """Get the run-scoped staging directory for local CI mode.

    Uses MONOREPO_CI_RUN_DIR if set, otherwise /tmp/monorepo-ci.
    Creates the directory if it doesn't exist.
    """
    d = Path(os.environ.get("MONOREPO_CI_RUN_DIR", "/tmp/monorepo-ci"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_metadata(key: str, default: str = "") -> str:
    """Get Buildkite metadata. Falls back to local JSON store."""
    if shutil.which("buildkite-agent") is not None:
        result = subprocess.run(
            ["buildkite-agent", "meta-data", "get", key, "--default", default],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else default
    # Local fallback: read from JSON file
    meta_file = _run_dir() / "metadata.json"
    if meta_file.exists():
        data: dict[str, str] = json.loads(meta_file.read_text())
        return data.get(key, default)
    return default


def set_metadata(key: str, value: str) -> None:
    """Set Buildkite metadata. Falls back to local JSON store."""
    if shutil.which("buildkite-agent") is not None:
        subprocess.run(
            ["buildkite-agent", "meta-data", "set", key, value],
            check=True,
        )
        return
    # Local fallback: write to JSON file
    meta_file = _run_dir() / "metadata.json"
    data: dict[str, str] = {}
    if meta_file.exists():
        data = json.loads(meta_file.read_text())
    data[key] = value
    meta_file.write_text(json.dumps(data, indent=2))
    print(f"[local] meta-data set {key}={value}", flush=True)


def annotate(message: str, *, style: str = "error", context: str = "default") -> None:
    """Create a Buildkite annotation. Prints to stderr locally."""
    if shutil.which("buildkite-agent") is not None:
        subprocess.run(
            ["buildkite-agent", "annotate", message, "--style", style, "--context", context],
            check=False,
        )
        return
    print(f"[{style}] {message}", file=sys.stderr, flush=True)


def artifact_upload(path: str | Path) -> None:
    """Upload an artifact via Buildkite or copy to local staging directory."""
    p = Path(path)
    if shutil.which("buildkite-agent") is not None:
        subprocess.run(
            ["buildkite-agent", "artifact", "upload", str(p)],
            check=True,
        )
        print(f"  Uploaded artifact: {p.name}", flush=True)
        return
    # Local fallback: copy to staging dir
    artifacts_dir = _run_dir() / "artifacts"
    artifacts_dir.mkdir(exist_ok=True)
    shutil.copy2(str(p), str(artifacts_dir / p.name))
    print(f"  [local] Staged artifact: {p.name} -> {artifacts_dir / p.name}", flush=True)


def artifact_download(name: str, dest_dir: str | Path) -> Path:
    """Download an artifact via Buildkite or read from local staging directory.

    Returns the path to the downloaded file.
    """
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)

    if shutil.which("buildkite-agent") is not None:
        subprocess.run(
            ["buildkite-agent", "artifact", "download", name, str(dest) + "/"],
            check=True,
        )
        return dest / name

    # Local fallback: copy from staging dir
    artifacts_dir = _run_dir() / "artifacts"
    src = artifacts_dir / name
    if src.exists():
        shutil.copy2(str(src), str(dest / name))
        print(f"  [local] Retrieved artifact: {name}", flush=True)
    else:
        # Check /tmp as final fallback (legacy behavior)
        tmp_src = Path(f"/tmp/{name}")
        if tmp_src.exists():
            shutil.copy2(str(tmp_src), str(dest / name))
            print(f"  [local] Retrieved artifact from /tmp: {name}", flush=True)
        else:
            print(f"  Warning: artifact {name} not found locally", flush=True)
    return dest / name
