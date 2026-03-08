#!/usr/bin/env bash
# Shell wrapper for running golangci-lint in the Bazel sandbox.
# Uses a hermetic golangci-lint binary provided via $GOLANGCI_LINT_BIN from @multitool.
# Note: golangci-lint requires Go on PATH to analyze Go code.

set -euo pipefail

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"

# Resolve hermetic binary to absolute path from runfiles
GOLANGCI_LINT="$(cd "$RUNFILES/$WS" && pwd)/$GOLANGCI_LINT_BIN"

cd "$RUNFILES/$WS/$PKG_DIR"

"$GOLANGCI_LINT" run ./...
