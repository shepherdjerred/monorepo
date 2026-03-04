#!/usr/bin/env bash
# Shell wrapper for running jscpd duplication detection in the Bazel sandbox.
# Uses the package-level .jscpd.json config to find duplicated code.

set -euo pipefail

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS/$PKG_DIR"

BUN_BINARY="$(cd "$(dirname "$BUN_TOOL")" && pwd)/$(basename "$BUN_TOOL")"
BUN_DIR="$(dirname "$BUN_BINARY")"
export PATH="$BUN_DIR:$PATH"

exec "$BUN_BINARY" x jscpd .
