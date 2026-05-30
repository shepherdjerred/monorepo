#!/usr/bin/env bash
# Claude Code WorktreeCreate hook: trust mise configs in a freshly created
# git worktree so `mise` can parse them without a manual `mise trust`.
#
# mise keys trust by absolute path, so every new worktree (and every nested
# package mise.toml inside it) needs its own trust entry. This mirrors the
# trust pass in scripts/setup.ts for the monorepo.
set -euo pipefail

command -v mise >/dev/null 2>&1 || exit 0

# Hook input JSON arrives on stdin; prefer an explicit worktree path from it,
# then fall back to the env the harness sets, then the current directory.
input="$(cat)"
dir=""
if command -v jq >/dev/null 2>&1; then
  dir="$(printf '%s' "$input" | jq -r '.worktree_path // .worktreePath // .path // .cwd // empty')"
fi
[ -n "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -d "$dir" ] || exit 0

cd "$dir"

# Trust the worktree root config (and any parent configs).
mise trust --yes --quiet --all

# Trust nested per-package mise configs; each absolute path needs its own entry.
while IFS= read -r cfg; do
  mise trust --yes --quiet "$cfg"
done < <(find "$dir" \
  \( -name node_modules -o -name .git -o -name archive -o -name dist -o -name build -o -name target \) -prune \
  -o -type f \( -name mise.toml -o -name .mise.toml \) -print)
