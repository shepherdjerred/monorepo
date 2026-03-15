#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv
install_helm

echo "+++ :helm: Push Helm charts to ChartMuseum"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.homelab_helm_push
