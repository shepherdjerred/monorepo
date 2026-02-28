#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv

echo "+++ :package: Publish"
cd scripts/ci && uv run python -m ci.publish
