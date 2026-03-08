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
cd "$TREE/{{PKG_DIR}}"
exec "$BUN" run "{{ENTRY_POINT}}" "$@"
