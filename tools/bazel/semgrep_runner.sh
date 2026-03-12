#!/usr/bin/env bash
# Shell wrapper for running Semgrep security scan in the Bazel sandbox.
# Runs auto-detection rules against the workspace source files.
# hermeticity-exempt: semgrep has OCaml+Python dual architecture that prevents pip.parse hermeticity

set -euo pipefail

if ! command -v semgrep &>/dev/null; then # hermeticity-exempt: semgrep requires system install (OCaml+Python)
  echo "ERROR: semgrep not found in PATH" >&2
  exit 1
fi

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
cd "$RUNFILES/$WS"

semgrep scan \
  --config auto \
  --error \
  --no-git \
  --exclude node_modules \
  --exclude .aspect_rules_js \
  --exclude "*.d.ts" \
  .
