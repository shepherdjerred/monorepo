#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv
install_ripgrep

echo "+++ :mag: Quality & Compliance"
# Run from repo root so quality/compliance checks can find packages/ and .quality-baseline.json
PYTHONPATH=scripts/ci/src uv run --project scripts/ci python -m ci.quality_gate
