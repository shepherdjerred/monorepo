"""ArgoCD API helpers.

Ported from .dagger/src/homelab-argocd.ts.
"""

from __future__ import annotations

import json
import time

from ci.lib import runner

ARGOCD_SERVER = "https://argocd.tailnet-1a49.ts.net"


def sync(
    app_name: str,
    token: str,
    *,
    server: str = ARGOCD_SERVER,
    dry_run: bool = False,
) -> str:
    """Trigger an ArgoCD sync for the given application.

    Args:
        app_name: The ArgoCD application name to sync.
        token: ArgoCD API bearer token.
        server: ArgoCD server URL.
        dry_run: If True, print what would be done without executing.

    Returns:
        A human-readable status message.
    """
    url = f"{server}/api/v1/applications/{app_name}/sync"
    response = runner.http_request(
        "POST",
        url,
        dry_run=dry_run,
        dry_run_text='{"status":{"sync":{"status":"Synced"},"health":{"status":"Healthy"}}}',
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        timeout=60,
    )

    if dry_run:
        return f"Sync triggered (dry-run): {app_name}"

    if response.status_code >= 200 and response.status_code < 300:
        return _parse_sync_response(response.text)

    # 409 means sync already in progress -- treat as success
    if response.status_code == 409 or "another operation is already in progress" in response.text:
        return f"Sync already in progress (skipped): {response.text}"

    response.raise_for_status()
    return response.text  # unreachable, but satisfies type checker


def wait_for_health(
    app_name: str,
    token: str,
    *,
    server: str = ARGOCD_SERVER,
    timeout: int = 300,
) -> str:
    """Poll ArgoCD until the application reports Healthy status.

    Args:
        app_name: The ArgoCD application name.
        token: ArgoCD API bearer token.
        server: ArgoCD server URL.
        timeout: Maximum seconds to wait.

    Returns:
        The final health status string.

    Raises:
        TimeoutError: If the application does not become healthy within the timeout.
    """
    deadline = time.monotonic() + timeout
    headers = {"Authorization": f"Bearer {token}"}

    while time.monotonic() < deadline:
        response = runner.http_request(
            "GET",
            f"{server}/api/v1/applications/{app_name}",
            headers=headers,
            timeout=30,
        )
        if response.status_code == 200:
            data = response.json()
            health: str = data.get("status", {}).get("health", {}).get("status", "Unknown")
            if health == "Healthy":
                return health
            sync_status = data.get("status", {}).get("sync", {}).get("status", "Unknown")
            print(f"  {app_name}: health={health}, sync={sync_status}", flush=True)
        time.sleep(10)

    msg = f"Timed out waiting for {app_name} to become healthy after {timeout}s"
    raise TimeoutError(msg)


def _parse_sync_response(body: str) -> str:
    """Parse ArgoCD sync response JSON into a human-readable message."""
    try:
        data = json.loads(body)
        status = data.get("status", {})
        phase = status.get("sync", {}).get("status", "Unknown")
        health = status.get("health", {}).get("status", "Unknown")
        revision = (status.get("sync", {}).get("revision", "Unknown"))[:8]
        resources_count = len(status.get("resources", []))
        conditions = status.get("conditions", [])
        message = (
            conditions[0].get("message", "")
            if conditions
            else data.get("message", "Sync completed")
        )
        return (
            f"Phase: {phase}, Health: {health}, "
            f"Revision: {revision}, Resources: {resources_count}\n{message}"
        )
    except (json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
        print(f"WARNING: Failed to parse ArgoCD sync response: {e}", flush=True)
        return body
