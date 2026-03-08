#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${RUNFILES_DIR:-}" ]]; then
    RUNFILES="$RUNFILES_DIR"
elif [[ -d "${BASH_SOURCE[0]}.runfiles" ]]; then
    RUNFILES="${BASH_SOURCE[0]}.runfiles"
elif [[ -d "$0.runfiles" ]]; then
    RUNFILES="$0.runfiles"
else
    echo "ERROR: Cannot find runfiles directory" >&2
    exit 1
fi
BUN="$RUNFILES/{{BUN_PATH}}"
TREE="$RUNFILES/{{TREE_PATH}}"
find "$TREE" -name "__snapshots__" -type d -exec chmod -R u+w {} + 2>/dev/null || true
cd "$TREE"
if [[ -n "${XML_OUTPUT_FILE:-}" ]]; then
    export BUN_JUNIT_OUTPUT_FILE="$XML_OUTPUT_FILE"
fi
exec "$BUN" test {{BAIL}} "$@"
