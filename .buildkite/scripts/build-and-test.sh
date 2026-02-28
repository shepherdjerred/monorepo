#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv

echo "+++ :bazel: Build & Test"
cd scripts/ci && uv run python -m ci.build_and_test
