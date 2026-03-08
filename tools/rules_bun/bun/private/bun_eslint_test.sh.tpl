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

# Dereference @prisma/client symlinks so TypeScript resolves .prisma/client locally
if [ -d node_modules/.prisma/client ] && [ -d node_modules/@prisma/client ]; then
    TMP_PRISMA=$(mktemp -d)
    cp -RL node_modules/@prisma/client "$TMP_PRISMA/"
    rm -rf node_modules/@prisma/client
    mv "$TMP_PRISMA/client" node_modules/@prisma/client
    rm -rf "$TMP_PRISMA"
fi

exec "$BUN" run ./node_modules/eslint/bin/eslint.js --no-cache --max-warnings=0 src/ "$@"
