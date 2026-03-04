#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv
install_gh

echo "+++ :cook: Cooklang Release"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.cooklang_release
