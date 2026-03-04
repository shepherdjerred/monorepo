#!/usr/bin/env bash
# Shell wrapper for running llvm-cov coverage report in the Bazel sandbox.
# Generates code coverage for Rust crates using cargo-llvm-cov.

set -euo pipefail

# Bazel's strict action env strips PATH and HOME; restore common locations
export HOME="${HOME:-/tmp}"
# Include mise-managed toolchains, cargo bin, and system paths
export PATH="${HOME}/.local/share/mise/shims:${HOME}/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

if ! command -v cargo-llvm-cov &>/dev/null; then
  echo "ERROR: cargo-llvm-cov not found in PATH" >&2
  echo "Install with: cargo install cargo-llvm-cov --locked" >&2
  exit 1
fi

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS/$PKG_DIR"

cargo llvm-cov --no-report
