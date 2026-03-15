#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_rust
install_uv

echo "+++ :rust: Build clauderon"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.clauderon_build "$@"
