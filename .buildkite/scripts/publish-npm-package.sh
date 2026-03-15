#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bun
install_uv

echo "+++ :npm: Publish to NPM"
# bun install needed for workspace resolution
cd "$(git rev-parse --show-toplevel)" && bun install
cd scripts/ci && PYTHONPATH=src uv run python -m ci.publish_npm_package "$@"
