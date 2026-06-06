#!/usr/bin/env bash
# Claude Code SessionStart hook: trust mise configs in the current workspace so
# `mise` can parse them without a manual `mise trust`.
#
# mise keys trust by absolute path, so every new worktree needs its own trust
# entry. This mirrors the trust pass in scripts/setup.ts for the monorepo.
set -euo pipefail

if ! command -v mise >/dev/null 2>&1; then
  exit 0
fi

input="$(cat)"
cwd=""
if command -v jq >/dev/null 2>&1; then
  cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"
fi

if [ -z "$cwd" ]; then
  cwd="${CLAUDE_PROJECT_DIR:-$PWD}"
fi

if [ ! -d "$cwd" ]; then
  exit 0
fi

cd "$cwd"

# Trust the workspace root config (and any parent configs).
mise trust --yes --quiet --all

# Trust nested per-package mise configs; each absolute path needs its own entry.
while IFS= read -r cfg; do
  mise trust --yes --quiet "$cfg"
done < <(find "$cwd" \
  \( -name node_modules -o -name .git -o -name archive -o -name dist -o -name build -o -name target \) -prune \
  -o -type f \( -name mise.toml -o -name .mise.toml \) -print)
