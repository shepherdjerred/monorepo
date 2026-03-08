#!/usr/bin/env bash
# Shell wrapper for running llvm-cov coverage report in the Bazel sandbox.
# Generates code coverage for Rust crates using cargo-llvm-cov.

set -euo pipefail

if [ -z "${CARGO_LLVM_COV_BIN:-}" ]; then
  echo "ERROR: CARGO_LLVM_COV_BIN not set" >&2
  exit 1
fi

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS/$PKG_DIR"

"$CARGO_LLVM_COV_BIN" llvm-cov --no-report
