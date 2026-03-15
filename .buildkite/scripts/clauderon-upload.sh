#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_gh
install_uv

echo "+++ :rust: Upload clauderon binaries"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.clauderon_upload
