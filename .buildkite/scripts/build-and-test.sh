#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv
install_ripgrep

echo "+++ :bazel: Build & Test"
ARGS=""
if [ -n "${BUILDKITE_BUILD_TARGETS:-}" ]; then
    # shellcheck disable=SC2086
    ARGS="--targets ${BUILDKITE_BUILD_TARGETS}"
fi
# shellcheck disable=SC2086
cd scripts/ci && PYTHONPATH=src uv run python -m ci.build_and_test ${ARGS} 2>&1 | tee /tmp/build-output.txt || {
    EXIT_CODE=$?
    # Upload last 200 lines as annotation for debugging
    tail -200 /tmp/build-output.txt | buildkite-agent annotate --style error --context build-error
    exit $EXIT_CODE
}
