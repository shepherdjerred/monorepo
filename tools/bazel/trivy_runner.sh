#!/usr/bin/env bash
# Shell wrapper for running Trivy filesystem scan in the Bazel sandbox.
# Scans the workspace root for vulnerabilities in lockfiles and configs.

set -euo pipefail

if ! command -v trivy &>/dev/null; then
  echo "ERROR: trivy not found in PATH" >&2
  exit 1
fi

SEVERITY="${TRIVY_SEVERITY:-HIGH,CRITICAL}"

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS"

trivy filesystem \
  --severity "$SEVERITY" \
  --exit-code 1 \
  --no-progress \
  .
