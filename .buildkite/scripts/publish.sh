#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv

echo "+++ :package: Publish"
ARGS=""
if [ -n "${BUILDKITE_PUBLISH_PACKAGES:-}" ]; then
    # shellcheck disable=SC2086
    ARGS="--packages ${BUILDKITE_PUBLISH_PACKAGES}"
fi
# shellcheck disable=SC2086
cd scripts/ci && uv run python -m ci.publish ${ARGS}
