#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_gh
install_uv

echo "+++ :cook: Create cooklang release"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.cooklang_create_release
