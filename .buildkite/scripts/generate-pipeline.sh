#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bazel
install_uv
install_target_determinator

# Ensure we have enough git history for target-determinator
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    echo "--- Deepening shallow clone"
    git fetch --deepen=100 || echo "Warning: failed to deepen clone, will build everything"
fi

# Fetch origin/main for merge-base comparison
git fetch origin main --depth=100 2>/dev/null || true

echo "+++ :pipeline: Generating dynamic pipeline"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.pipeline_generator | buildkite-agent pipeline upload
