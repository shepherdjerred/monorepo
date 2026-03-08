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
cd "$TREE"

# Fix tsconfig extends paths — the materialized tree is flat, so relative
# parent paths (../../tsconfig.base.json) must be rewritten to local copies.
if [ -f tsconfig.base.json ] && [ -f tsconfig.json ]; then
    chmod u+w tsconfig.json 2>/dev/null || true
    sed 's|"extends":[ ]*"[^"]*tsconfig\.base\.json"|"extends": "./tsconfig.base.json"|g' tsconfig.json > tsconfig.json.tmp
    mv tsconfig.json.tmp tsconfig.json
fi

exec "$BUN" run ./node_modules/eslint/bin/eslint.js --no-cache --max-warnings=0 src/ "$@"
