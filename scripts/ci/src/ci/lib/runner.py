"""Dry-run-aware wrapper for subprocess and HTTP calls."""

from __future__ import annotations

import subprocess
from typing import Any

import httpx


def run(
    cmd: list[str],
    *,
    dry_run: bool = False,
    capture_output: bool = False,
    text: bool = True,
    check: bool = True,
    cwd: str | None = None,
    env: dict[str, str] | None = None,
    dry_run_stdout: str = "",
    print_cmd: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Run a subprocess command, with dry-run support.

    In dry-run mode, prints the command prefixed with "[DRY RUN]" and returns
    a synthetic CompletedProcess with returncode=0 and the provided dry_run_stdout.

    In normal mode, prints the command prefixed with "+" (if print_cmd) and runs it.
    """
    if dry_run:
        print(f"[DRY RUN] {' '.join(cmd)}", flush=True)
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=0,
            stdout=dry_run_stdout,
            stderr="",
        )

    if print_cmd:
        print(f"+ {' '.join(cmd)}", flush=True)
    return subprocess.run(
        cmd,
        capture_output=capture_output,
        text=text,
        check=check,
        cwd=cwd,
        env=env,
    )


def http_request(
    method: str,
    url: str,
    *,
    dry_run: bool = False,
    dry_run_text: str = "{}",
    dry_run_status: int = 200,
    **kwargs: Any,
) -> httpx.Response:
    """Make an HTTP request, with dry-run support.

    In dry-run mode, prints the request and returns a synthetic Response.
    In normal mode, delegates to httpx.request().
    """
    if dry_run:
        print(f"[DRY RUN] {method.upper()} {url}", flush=True)
        return httpx.Response(status_code=dry_run_status, text=dry_run_text)

    return httpx.request(method, url, **kwargs)
