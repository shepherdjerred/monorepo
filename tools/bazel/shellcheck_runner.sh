#!/usr/bin/env bash
# Shell wrapper for running ShellCheck in the Bazel sandbox.
# Receives shell script paths as arguments and runs ShellCheck on each.

set -euo pipefail

# Bazel's strict action env strips PATH; add common binary locations
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME:-/tmp}/.local/share/mise/shims:${PATH:-}"

if ! command -v shellcheck &>/dev/null; then
  echo "ERROR: shellcheck not found in PATH" >&2
  exit 1
fi

if [ $# -eq 0 ]; then
  echo "ERROR: no shell scripts provided" >&2
  exit 1
fi

shellcheck "$@"
