#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv

# Usage: bazel-phase.sh //packages/birmel/... build
TARGET="${1:?Usage: bazel-phase.sh <target-pattern> <phase>}"
PHASE="${2:?Usage: bazel-phase.sh <target-pattern> <phase>}"

echo "+++ :bazel: ${PHASE}: ${TARGET}"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.bazel_phase --target "${TARGET}" --phase "${PHASE}"
