"""Cloudflare DNS API helpers.

Ported from .dagger/src/lib-cloudflare.ts.
"""

from __future__ import annotations

import httpx

CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"


def update_dns_record(
    zone_id: str,
    record_name: str,
    record_value: str,
    token: str,
    *,
    record_type: str = "CNAME",
    proxied: bool = True,
) -> str:
    """Create or update a Cloudflare DNS record.

    Looks up existing records by name and type. If found, updates in place;
    otherwise creates a new record.

    Args:
        zone_id: Cloudflare zone ID.
        record_name: DNS record name (e.g. "app.example.com").
        record_value: DNS record value (e.g. IP or CNAME target).
        token: Cloudflare API token.
        record_type: DNS record type (default: CNAME).
        proxied: Whether the record should be proxied through Cloudflare.

    Returns:
        A status message.
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # Look up existing record
    list_response = httpx.get(
        f"{CLOUDFLARE_API}/zones/{zone_id}/dns_records",
        params={"name": record_name, "type": record_type},
        headers=headers,
        timeout=30,
    )
    list_response.raise_for_status()
    records = list_response.json().get("result", [])

    payload = {
        "type": record_type,
        "name": record_name,
        "content": record_value,
        "proxied": proxied,
    }

    if records:
        # Update existing record
        record_id = records[0]["id"]
        response = httpx.put(
            f"{CLOUDFLARE_API}/zones/{zone_id}/dns_records/{record_id}",
            json=payload,
            headers=headers,
            timeout=30,
        )
    else:
        # Create new record
        response = httpx.post(
            f"{CLOUDFLARE_API}/zones/{zone_id}/dns_records",
            json=payload,
            headers=headers,
            timeout=30,
        )

    response.raise_for_status()
    return f"DNS record {record_name} -> {record_value} ({record_type})"
