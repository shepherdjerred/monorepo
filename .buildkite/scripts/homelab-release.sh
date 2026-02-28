#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bun
install_uv
install_helm
install_tofu

# Docker is available in the k8s pod via DinD or socket mount
echo "+++ :kubernetes: Homelab Release"
cd scripts/ci && uv run python -m ci.homelab_release
