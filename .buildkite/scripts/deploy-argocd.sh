#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv

echo "+++ :argocd: Sync ArgoCD"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.deploy_argocd "$@"
