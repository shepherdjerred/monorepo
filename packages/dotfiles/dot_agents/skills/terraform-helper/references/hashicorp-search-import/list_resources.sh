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
    # Specific provider
    provider_key=$(printf '%s\n' "$schema_json" | jq -r --arg provider "$PROVIDER" \
        '.provider_schemas | keys[] | select(endswith("/" + $provider))')
    if [ -n "$provider_key" ]; then
        printf '%s\n' "$schema_json" | jq -r \
            "{\"$PROVIDER\": (.provider_schemas.\"${provider_key}\" | .list_resource_schemas // {} | keys | sort)}"
    else
        echo "{\"$PROVIDER\": []}"
    fi
else
    # All providers
    printf '%s\n' "$schema_json" | jq -r '
        .provider_schemas
        | to_entries
        | map({key: (.key | split("/")[-1]), value: (.value.list_resource_schemas // {} | keys | sort)})
        | from_entries
    '
fi
