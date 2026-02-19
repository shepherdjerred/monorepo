#!/usr/bin/env bash
# Delegate to the TypeScript implementation
exec bun "$(dirname "$0")/quality-ratchet.ts" "$@"
