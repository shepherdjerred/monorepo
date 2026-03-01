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
ARGS=""
if [ -n "${BUILDKITE_DEPLOY_SITES:-}" ]; then
    # shellcheck disable=SC2086
    ARGS="--sites ${BUILDKITE_DEPLOY_SITES}"
fi
# shellcheck disable=SC2086
cd scripts/ci && PYTHONPATH=src uv run python -m ci.deploy ${ARGS}
