#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bun
install_uv
install_awscli

echo "+++ :ship: Deploy site"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.deploy_site "$@"
