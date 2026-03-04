#!/usr/bin/env bash
# Shell wrapper for running golangci-lint in the Bazel sandbox.

set -euo pipefail

# Bazel's strict action env strips PATH and HOME; restore common locations
export HOME="${HOME:-/tmp}"
# Include mise-managed toolchains, Go bin, and system paths
export PATH="${HOME}/.local/share/mise/shims:${HOME}/go/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

if ! command -v golangci-lint &>/dev/null; then
  echo "ERROR: golangci-lint not found in PATH" >&2
  exit 1
fi

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS/$PKG_DIR"

golangci-lint run ./...
