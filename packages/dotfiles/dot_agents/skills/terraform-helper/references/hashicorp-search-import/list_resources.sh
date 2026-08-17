#!/bin/bash
# Copyright IBM Corp. 2025, 2026
# SPDX-License-Identifier: MPL-2.0

# Extract list resources supported by Terraform providers
# Usage: bash list_resources.sh [provider_name]
# Requires: terraform, jq
# Note: Run from an initialized Terraform directory (terraform init)

set -e

PROVIDER=$1

# Ensure terraform is initialized
if [ ! -d ".terraform" ]; then
    echo "Terraform is not initialized; run terraform init and retry." >&2
    exit 1
fi

# Get provider schema and extract list_resource_schemas
schema_json=$(terraform providers schema -json)
if [ -n "$PROVIDER" ]; then
    # Specific provider — prefer an exact source-address match; fall back to an
    # unambiguous short-name suffix match. Reject ambiguous suffix matches
    # (e.g. hashicorp/foo and acme/foo) instead of silently combining keys.
    matches_json=$(printf '%s\n' "$schema_json" | jq -c --arg provider "$PROVIDER" \
        '[.provider_schemas | keys[] | select(. == $provider or endswith("/" + $provider))]')
    match_count=$(printf '%s\n' "$matches_json" | jq 'length')

    if [ "$match_count" -eq 0 ]; then
        echo "{\"$PROVIDER\": []}"
    elif [ "$match_count" -gt 1 ]; then
        echo "Ambiguous provider name \"$PROVIDER\" matches multiple provider sources:" >&2
        printf '%s\n' "$matches_json" | jq -r '.[]' >&2
        echo "Pass the fully-qualified source address instead (e.g. registry.terraform.io/hashicorp/$PROVIDER)." >&2
        exit 1
    else
        provider_key=$(printf '%s\n' "$matches_json" | jq -r '.[0]')
        printf '%s\n' "$schema_json" | jq -r --arg provider "$PROVIDER" --arg key "$provider_key" \
            '{($provider): (.provider_schemas[$key].list_resource_schemas // {} | keys | sort)}'
    fi
else
    # All providers — detect short-name collisions before producing lossy keys.
    # from_entries silently overwrites duplicate keys, so two providers with the
    # same final path segment (e.g. hashicorp/foo and acme/foo) would otherwise
    # drop one provider's resources without any error.
    collisions=$(printf '%s\n' "$schema_json" | jq -r '
        .provider_schemas
        | keys
        | map({source: ., short: (split("/")[-1])})
        | group_by(.short)
        | map(select(length > 1))
        | map("\(.[0].short): " + (map(.source) | join(", ")))
        | .[]
    ')
    if [ -n "$collisions" ]; then
        echo "Multiple providers share the same short name; results would be lossy:" >&2
        printf '%s\n' "$collisions" >&2
        echo "Re-run with a specific fully-qualified provider argument instead." >&2
        exit 1
    fi

    printf '%s\n' "$schema_json" | jq -r '
        .provider_schemas
        | to_entries
        | map({key: (.key | split("/")[-1]), value: (.value.list_resource_schemas // {} | keys | sort)})
        | from_entries
    '
fi
