#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv

echo "+++ :bazel: Build & Test"
ARGS=""
if [ -n "${BUILDKITE_BUILD_TARGETS:-}" ]; then
    # shellcheck disable=SC2086
    ARGS="--targets ${BUILDKITE_BUILD_TARGETS}"
fi
# shellcheck disable=SC2086
cd scripts/ci && PYTHONPATH=src uv run python -m ci.build_and_test ${ARGS}
