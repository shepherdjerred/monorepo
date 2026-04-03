#!/usr/bin/env bash
# Delegate to the TypeScript implementation
exec bun "$(dirname "$0")/check-dagger-hygiene.ts" "$@"
