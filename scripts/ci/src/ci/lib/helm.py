"""Helm chart packaging and ChartMuseum publishing.

Ported from .dagger/src/homelab-helm.ts.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import httpx

CHARTMUSEUM_URL = "https://chartmuseum.tailnet-1a49.ts.net"


def package(chart_dir: str, version: str) -> str:
    """Package a Helm chart directory into a .tgz archive.

    Args:
        chart_dir: Path to the Helm chart directory (containing Chart.yaml).
        version: Version string to set in Chart.yaml.

    Returns:
        Path to the packaged .tgz file.
    """
    cmd = [
        "helm",
        "package",
        chart_dir,
        "--version",
        version,
        "--app-version",
        version,
    ]
    print(f"+ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    # helm package outputs "Successfully packaged chart and saved it to: /path/to/chart-X.Y.Z.tgz"
    for line in result.stdout.strip().splitlines():
        if line.startswith("Successfully packaged"):
            return line.split(": ", 1)[1]
    # Fallback: construct the expected path
    chart_name = Path(chart_dir).name
    return f"{chart_name}-{version}.tgz"


def push_to_chartmuseum(
    chart_path: str,
    *,
    url: str = CHARTMUSEUM_URL,
    username: str,
    password: str,
) -> str:
    """Upload a packaged Helm chart to a ChartMuseum instance.

    Args:
        chart_path: Path to the .tgz chart file.
        url: ChartMuseum base URL.
        username: ChartMuseum username.
        password: ChartMuseum password.

    Returns:
        Response text from ChartMuseum.

    Raises:
        httpx.HTTPStatusError: On non-2xx responses (except 409 Conflict).
    """
    with open(chart_path, "rb") as f:
        chart_data = f.read()

    response = httpx.post(
        f"{url}/api/charts",
        content=chart_data,
        auth=(username, password),
        headers={"Content-Type": "application/octet-stream"},
        timeout=60,
    )

    # 409 means chart already exists -- treat as success
    if response.status_code == 409:
        return "409 Conflict: Chart already exists, treating as success."

    response.raise_for_status()
    return response.text or "Chart published successfully"
