#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bun
install_uv

echo "+++ :cdk8s: Build cdk8s manifests"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.homelab_cdk8s
