"""Helm chart packaging and ChartMuseum publishing.

Ported from .dagger/src/homelab-helm.ts.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from shutil import copytree

import httpx

CHARTMUSEUM_URL = "https://chartmuseum.tailnet-1a49.ts.net"


def package(chart_dir: str, version: str, *, dist_dir: str | None = None) -> str:
    """Package a Helm chart directory into a .tgz archive.

    Chart.yaml uses placeholder ``$version`` / ``$appVersion`` which helm
    rejects as invalid semver.  We patch a temp copy before packaging.

    If *dist_dir* is provided, the CDK8s-generated manifest
    ``{dist_dir}/{chart_name}.k8s.yaml`` is copied into ``templates/``.
    """
    src = Path(chart_dir)
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / src.name
        copytree(src, dst)
        chart_yaml = dst / "Chart.yaml"
        text = chart_yaml.read_text()
        text = text.replace('"$version"', f'"{version}"')
        text = text.replace('"$appVersion"', f'"{version}"')
        chart_yaml.write_text(text)

        # Copy CDK8s manifest into templates/
        if dist_dir:
            manifest = Path(dist_dir) / f"{src.name}.k8s.yaml"
            if manifest.exists():
                templates = dst / "templates"
                templates.mkdir(exist_ok=True)
                import shutil
                shutil.copy2(str(manifest), str(templates / manifest.name))
            else:
                print(f"  Warning: no manifest at {manifest}", flush=True)

        cmd = [
            "helm",
            "package",
            str(dst),
            "--version",
            version,
            "--app-version",
            version,
        ]
        print(f"+ {' '.join(cmd)}", flush=True)
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

    for line in result.stdout.strip().splitlines():
        if line.startswith("Successfully packaged"):
            return line.split(": ", 1)[1]
    chart_name = src.name
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
