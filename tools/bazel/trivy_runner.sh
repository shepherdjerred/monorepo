#!/usr/bin/env bash
# Shell wrapper for running Trivy filesystem scan in the Bazel sandbox.
# Scans the workspace root for vulnerabilities in lockfiles and configs.
# Uses a hermetic Trivy binary provided via $TRIVY_BIN from @multitool.

set -euo pipefail

SEVERITY="${TRIVY_SEVERITY:-HIGH,CRITICAL}"

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"

# Resolve hermetic binary to absolute path from runfiles
TRIVY="$(cd "$RUNFILES/$WS" && pwd)/$TRIVY_BIN"

cd "$RUNFILES/$WS"

"$TRIVY" filesystem \
  --severity "$SEVERITY" \
  --exit-code 1 \
  --no-progress \
  .
