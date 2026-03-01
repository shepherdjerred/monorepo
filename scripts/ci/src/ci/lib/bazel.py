from __future__ import annotations

import subprocess
import sys


def build(*targets: str, config: str = "ci", stamp: bool = False, bep_file: str | None = None) -> None:
    """Run bazel build with the given targets."""
    cmd = ["bazel", "build", f"--config={config}"]
    if stamp:
        cmd.append("--stamp")
    if bep_file:
        cmd.append(f"--build_event_binary_file={bep_file}")
    cmd.extend(targets)
    _run(cmd)


def test(*targets: str, config: str = "ci", bep_file: str | None = None) -> None:
    """Run bazel test with the given targets."""
    cmd = ["bazel", "test", f"--config={config}"]
    if bep_file:
        cmd.append(f"--build_event_binary_file={bep_file}")
    cmd.extend(targets)
    _run(cmd)


def run(target: str, config: str = "ci", stamp: bool = False, embed_label: str | None = None) -> None:
    """Run a bazel target."""
    cmd = ["bazel", "run", f"--config={config}"]
    if stamp:
        cmd.append("--stamp")
    if embed_label:
        cmd.append(f"--embed_label={embed_label}")
    cmd.append(target)
    _run(cmd)


def run_capture(target: str, config: str = "ci", stamp: bool = False, embed_label: str | None = None) -> str:
    """Run a bazel target and return its stdout."""
    cmd = ["bazel", "run", f"--config={config}"]
    if stamp:
        cmd.append("--stamp")
    if embed_label:
        cmd.append(f"--embed_label={embed_label}")
    cmd.append(target)
    print(f"+ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def query(expression: str) -> str:
    """Run bazel query and return stdout."""
    cmd = ["bazel", "query", expression]
    print(f"+ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def affected_targets(base_revision: str, ignore_file: str | None = None) -> list[str]:
    """Run target-determinator to find affected targets since base_revision.

    Returns a list of affected Bazel target labels.
    Raises subprocess.CalledProcessError if target-determinator fails.
    """
    cmd = ["target-determinator", "-targets=//packages/..."]
    if ignore_file:
        cmd.append(f"-ignore-file={ignore_file}")
    cmd.append(base_revision)
    print(f"+ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    targets = [t.strip() for t in result.stdout.strip().splitlines() if t.strip()]
    return targets


def _run(cmd: list[str]) -> None:
    """Execute a command, printing it first. Exit on failure."""
    print(f"+ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        sys.exit(result.returncode)
