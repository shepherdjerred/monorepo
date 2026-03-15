#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bun
install_uv

echo "+++ :cook: Build cooklang plugin"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.cooklang_build
