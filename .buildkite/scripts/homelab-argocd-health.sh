#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv

echo "+++ :argocd: Wait for ArgoCD healthy"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.homelab_argocd_health "$@"
