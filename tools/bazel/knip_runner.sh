#!/usr/bin/env bash
# Shell wrapper for running Knip dead code detection in the Bazel sandbox.
# Uses the workspace knip.json config to find unused exports and dependencies.

set -euo pipefail

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS"

BUN_BINARY="$(cd "$(dirname "$BUN_TOOL")" && pwd)/$(basename "$BUN_TOOL")"
BUN_DIR="$(dirname "$BUN_BINARY")"
export PATH="$BUN_DIR:$PATH"

exec "$BUN_BINARY" x knip
