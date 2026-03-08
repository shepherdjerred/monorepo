#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv
install_node

# renovate: datasource=npm depName=release-please
RELEASE_PLEASE_VERSION="17.3.0"
echo "--- :package: Installing release-please ${RELEASE_PLEASE_VERSION}"
bun add -g "release-please@${RELEASE_PLEASE_VERSION}"

echo "+++ :bookmark: Release"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.release
