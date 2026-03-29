#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_bun

# Dryrun mode: skip releases/deploys while stabilizing CI (remove when ready)
export DRYRUN=true

echo "+++ :pipeline: Generating dynamic pipeline"
cd scripts/ci && bun run src/main.ts | buildkite-agent pipeline upload
