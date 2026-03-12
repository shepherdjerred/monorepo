#!/usr/bin/env bash
# Structural anti-pattern linter for Bazel BUILD files and rules.
# Run via: bazel test //tools/bazel:bazel_lint_check
set -euo pipefail

ERRORS=0
ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(git rev-parse --show-toplevel)}"

fail() {
    echo "FAIL: $1" >&2
    ERRORS=$((ERRORS + 1))
}

# 1. bun-types instead of @types/bun in BUILD.bazel
if grep -rn '"bun-types"' "$ROOT/packages/"*/BUILD.bazel 2>/dev/null; then
    fail "Use @types/bun instead of bun-types in BUILD.bazel deps"
fi

# 2. readlink -f in tools/ (not portable on macOS)
# Exclude: this script, materialize.bzl's portable _realpath fallback
if grep -rn 'readlink -f' "$ROOT/tools/" --include='*.sh' --include='*.bzl' 2>/dev/null \
    | grep -v 'bazel_lint_check.sh' \
    | grep -v 'Portable realpath' \
    | grep -v 'readlink -f "$path"' \
    | grep -q .; then
    grep -rn 'readlink -f' "$ROOT/tools/" --include='*.sh' --include='*.bzl' 2>/dev/null \
        | grep -v 'bazel_lint_check.sh' \
        | grep -v 'Portable realpath' \
        | grep -v 'readlink -f "$path"'
    fail "readlink -f is not portable — use _realpath or \$BUN_BINARY"
fi

# 3. python3 in runner scripts (use bun instead)
if grep -rn 'python3' "$ROOT/tools/bazel/"*_runner.sh 2>/dev/null; then
    fail "python3 in runner scripts — use \$BUN_BINARY instead"
fi

# 4. /usr/local/bin in PATH exports in .bzl files (container entrypoints are fine)
if grep -rn 'PATH.*=/usr/local/bin\|PATH.*:/usr/local/bin' "$ROOT/tools/"**/*.bzl 2>/dev/null | grep -v "hermeticity-exempt" | grep -q .; then
    grep -rn 'PATH.*=/usr/local/bin\|PATH.*:/usr/local/bin' "$ROOT/tools/"**/*.bzl 2>/dev/null | grep -v "hermeticity-exempt"
    fail "/usr/local/bin in .bzl PATH exports — remove for hermiticity"
fi

# 5. || true in bun_prisma_generate.bzl (swallows errors)
if grep -n '|| true' "$ROOT/tools/rules_bun/bun/private/bun_prisma_generate.bzl" 2>/dev/null; then
    fail "|| true in bun_prisma_generate.bzl — use proper error handling"
fi

if [ "$ERRORS" -gt 0 ]; then
    echo ""
    echo "$ERRORS anti-pattern(s) found"
    exit 1
fi

echo "All structural lint checks passed"
