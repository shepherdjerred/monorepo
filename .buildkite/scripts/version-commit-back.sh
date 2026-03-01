#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv
install_gh

echo "+++ :bookmark: Version Commit-Back"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.version_commit_back
