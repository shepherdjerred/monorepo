#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv
install_tofu

echo "+++ :terraform: Apply OpenTofu stack"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.homelab_tofu_stack "$@"
