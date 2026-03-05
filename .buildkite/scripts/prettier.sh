#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bun

echo "+++ :art: Prettier formatting check"
bun install --frozen-lockfile
bunx prettier --check 'packages/**/*.{ts,tsx,js,jsx,json,css,md}'
