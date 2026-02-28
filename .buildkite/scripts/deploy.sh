#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_bun
install_uv
install_kubectl
install_helm
install_awscli
install_tofu

echo "+++ :ship: Deploy"
cd scripts/ci && uv run python -m ci.deploy
