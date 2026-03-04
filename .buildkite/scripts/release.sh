#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv
install_node

echo "--- :package: Installing release-please"
bun add -g release-please

echo "+++ :bookmark: Release"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.release
