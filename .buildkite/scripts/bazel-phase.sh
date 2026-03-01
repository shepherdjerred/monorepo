#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv

# Usage: bazel-phase.sh //packages/birmel/... build [--stamp-images]
TARGET="${1:?Usage: bazel-phase.sh <target-pattern> <phase> [--stamp-images]}"
PHASE="${2:?Usage: bazel-phase.sh <target-pattern> <phase> [--stamp-images]}"
STAMP_FLAG=""
[ "${3:-}" = "--stamp-images" ] && STAMP_FLAG="--stamp-images"

echo "+++ :bazel: ${PHASE}: ${TARGET}"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.bazel_phase --target "${TARGET}" --phase "${PHASE}" ${STAMP_FLAG}
