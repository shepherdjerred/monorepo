#!/usr/bin/env python3
"""Check all 1Password items across all vaults for duplicate field values."""

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed


def run_op(args: list[str]) -> str:
    result = subprocess.run(
        ["op", *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return ""
    return result.stdout


def get_vaults() -> list[dict]:
    out = run_op(["vault", "list", "--format", "json"])
    return json.loads(out) if out else []


def get_items(vault_id: str) -> list[dict]:
    out = run_op(["item", "list", "--vault", vault_id, "--format", "json"])
    return json.loads(out) if out else []


def get_item_details(item_id: str, vault_id: str) -> dict | None:
    out = run_op(["item", "get", item_id, "--vault", vault_id, "--format", "json", "--reveal"])
    return json.loads(out) if out else None


SKIP_FIELD_TYPES = {"OTP", "REFERENCE", "MENU"}
SKIP_PURPOSES = {"NOTES", "USERNAME"}

# Labels that indicate non-secret fields
SKIP_LABELS = {
    "username", "email", "user", "name", "url", "website", "hostname", "server",
    "phone", "address", "city", "state", "zip", "postal", "country", "street",
    "first", "last", "middle", "title", "company", "organization",
}

# Values that are clearly not secrets (button text, form labels, etc.)
NOISE_VALUES = {
    "submit", "login", "sign in", "sign up", "register", "next", "continue",
    "toggle navigation", "remember me", "forgot password", "create account",
    "true", "false", "yes", "no", "on", "off", "none", "null",
}


def extract_fields(item: dict) -> list[tuple[str, str, str]]:
    """Extract (section_label, field_label, value) tuples from an item.

    Only extracts secret-like fields (passwords, tokens, keys, credentials).
    Skips usernames, emails, URLs, and other non-secret fields.
    """
    results = []
    for field in item.get("fields", []):
        if field.get("type", "") in SKIP_FIELD_TYPES:
            continue
        if field.get("purpose", "") in SKIP_PURPOSES:
            continue
        value = field.get("value", "")
        if not value:
            continue

        # Skip noise values
        if value.lower().strip() in NOISE_VALUES:
            continue

        label = field.get("label", "(unlabeled)")
        label_lower = label.lower()

        # Skip non-secret fields by label
        if any(skip in label_lower for skip in SKIP_LABELS):
            continue

        # Skip unlabeled fields (browser-captured form junk)
        if label == "(unlabeled)":
            continue

        # Skip values that look like emails
        if "@" in value and "." in value.split("@")[-1]:
            continue

        # Skip values that look like URLs
        if value.startswith(("http://", "https://", "ftp://")):
            continue

        # Skip very short values and pure numbers under 6 digits (zip codes, etc.)
        if len(value) <= 5 and value.replace("-", "").replace(" ", "").isdigit():
            continue

        section = field.get("section")
        section_label = section.get("label", "") if section else ""
        results.append((section_label, label, value))
    return results


def fetch_one(item_summary: dict, vault_id: str, vault_name: str) -> tuple[str, str, str, list[tuple[str, str, str]]] | None:
    """Fetch a single item's details. Returns (vault_name, item_title, item_id, fields) or None."""
    item_id = item_summary["id"]
    item_title = item_summary.get("title", "(untitled)")
    details = get_item_details(item_id, vault_id)
    if details is None:
        return None
    return (vault_name, item_title, item_id, extract_fields(details))


def main():
    parser = argparse.ArgumentParser(description="Check 1Password for duplicate field values across all vaults.")
    parser.add_argument("--min-length", type=int, default=4, help="Minimum value length to consider (default: 4)")
    parser.add_argument("--workers", type=int, default=8, help="Parallel op CLI workers (default: 8)")
    args = parser.parse_args()

    print("Fetching vaults...", file=sys.stderr)
    vaults = get_vaults()
    if not vaults:
        print("No vaults found. Is `op` signed in?", file=sys.stderr)
        sys.exit(2)

    print(f"Found {len(vaults)} vault(s): {', '.join(v['name'] for v in vaults)}", file=sys.stderr)

    # Collect all (item_summary, vault_id, vault_name) tuples first
    work = []
    for vault in vaults:
        vault_id = vault["id"]
        vault_name = vault["name"]
        items = get_items(vault_id)
        print(f"  {vault_name}: {len(items)} item(s)", file=sys.stderr)
        for item_summary in items:
            work.append((item_summary, vault_id, vault_name))

    print(f"\nFetching {len(work)} items with {args.workers} workers...", file=sys.stderr)

    # value -> list of (vault_name, item_title, item_id, section, field_label)
    value_locations: dict[str, list[tuple[str, str, str, str, str]]] = defaultdict(list)
    total_items = 0
    total_fields = 0
    done = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(fetch_one, item_summary, vault_id, vault_name): (item_summary, vault_name)
            for item_summary, vault_id, vault_name in work
        }

        for future in as_completed(futures):
            done += 1
            result = future.result()
            if result is None:
                continue

            vault_name, item_title, item_id, fields = result
            total_items += 1

            for section_label, field_label, value in fields:
                if len(value) < args.min_length:
                    continue
                total_fields += 1
                value_locations[value].append((vault_name, item_title, item_id, section_label, field_label))

            if done % 10 == 0 or done == len(work):
                print(f"  [{done}/{len(work)}] fetched", file=sys.stderr)

    # Find duplicates — only where the value appears in 2+ DIFFERENT items
    duplicates: dict[str, list[tuple[str, str, str, str, str]]] = {}
    for value, locs in value_locations.items():
        if len(locs) < 2:
            continue
        # Deduplicate by item_id — if all occurrences are in the same item, skip
        unique_items = {item_id for _, _, item_id, _, _ in locs}
        if len(unique_items) < 2:
            continue
        duplicates[value] = locs

    # Separate cross-vault duplicates from same-vault duplicates
    cross_vault = {}
    same_vault = {}
    for value, locs in duplicates.items():
        vaults_seen = {vault_name for vault_name, _, _, _, _ in locs}
        if len(vaults_seen) > 1:
            cross_vault[value] = locs
        else:
            # Same vault but different items
            unique_items = {item_id for _, _, item_id, _, _ in locs}
            if len(unique_items) > 1:
                same_vault[value] = locs

    print(f"\n{'='*80}", file=sys.stderr)
    print(f"Scanned {total_items} items, {total_fields} field values", file=sys.stderr)
    print(f"Cross-vault duplicates: {len(cross_vault)}", file=sys.stderr)
    print(f"Same-vault, different-item duplicates: {len(same_vault)}", file=sys.stderr)

    if not cross_vault and not same_vault:
        print("\nNo duplicates found.", file=sys.stderr)
        sys.exit(0)

    n = 0

    if cross_vault:
        print(f"\n{'='*80}")
        print(f"CROSS-VAULT DUPLICATES: {len(cross_vault)}")
        print(f"{'='*80}")

        for value, locations in sorted(cross_vault.items(), key=lambda x: len(x[1]), reverse=True):
            n += 1
            print(f"\n--- #{n} ({len(locations)} occurrences across {len({v for v,_,_,_,_ in locations})} vaults) ---")
            print(f"Value: {value}")
            print("Locations:")
            for vault_name, item_title, item_id, section_label, field_label in locations:
                section_part = f" > {section_label}" if section_label else ""
                print(f"  - [{vault_name}] {item_title} ({item_id}){section_part} > {field_label}")

    if same_vault:
        print(f"\n{'='*80}")
        print(f"SAME-VAULT, DIFFERENT-ITEM DUPLICATES: {len(same_vault)}")
        print(f"{'='*80}")

        for value, locations in sorted(same_vault.items(), key=lambda x: len(x[1]), reverse=True):
            n += 1
            unique_items = {(item_title, item_id) for _, item_title, item_id, _, _ in locations}
            if len(unique_items) < 2:
                continue
            print(f"\n--- #{n} ({len(locations)} occurrences in {len(unique_items)} items) ---")
            print(f"Value: {value}")
            print("Locations:")
            for vault_name, item_title, item_id, section_label, field_label in locations:
                section_part = f" > {section_label}" if section_label else ""
                print(f"  - [{vault_name}] {item_title} ({item_id}){section_part} > {field_label}")

    total = len(cross_vault) + len(same_vault)
    print(f"\n{'='*80}")
    print(f"Total: {total} duplicate value(s)")
    sys.exit(1 if total > 0 else 0)


if __name__ == "__main__":
    main()
