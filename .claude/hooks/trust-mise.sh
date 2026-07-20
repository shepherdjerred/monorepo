#!/usr/bin/env bash
# Trust mise configs only for a local Claude Code session. Cloud sessions use a
# managed environment and must not mutate its trust store.
set -euo pipefail

[ -z "${CLAUDE_CODE_REMOTE:-}" ] || exit 0

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v mise >/dev/null 2>&1 || exit 0

input="$(cat)"
dir=""
if [ -n "$input" ] && command -v jq >/dev/null 2>&1; then
  dir="$(printf '%s' "$input" | jq -r '.cwd // empty')"
fi
[ -n "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -d "$dir" ] || exit 0

cd "$dir"
set +e
mise trust --yes --quiet --all >/dev/null

# Only walk nested per-package mise.toml files inside a linked worktree — trust
# persists per absolute path, so a fresh worktree path starts fully untrusted
# even when the main checkout's configs are already trusted.
git_dir=""
common_dir=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git_dir="$(git rev-parse --absolute-git-dir)"
  common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
fi
if [ -n "$git_dir" ] && [ "$git_dir" != "$common_dir" ]; then
  while IFS= read -r cfg; do
    mise trust --yes --quiet "$cfg" >/dev/null
  done < <(find "$dir" \
    \( -name node_modules -o -name .git -o -name archive -o -name dist -o -name build -o -name target \) -prune \
    -o -type f \( -name mise.toml -o -name .mise.toml \) -print)
fi
