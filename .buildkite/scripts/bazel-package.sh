#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv

# Usage: bazel-package.sh //packages/birmel/... [--stamp-images]
TARGET="${1:?Usage: bazel-package.sh <target-pattern> [--stamp-images]}"
STAMP_FLAG=""
if [ "${2:-}" = "--stamp-images" ]; then
    STAMP_FLAG="--stamp-images"
fi

echo "+++ :bazel: Package build: ${TARGET}"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.bazel_package --target "${TARGET}" ${STAMP_FLAG}
