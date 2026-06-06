#!/usr/bin/env bash
# Claude Code SessionStart hook: trust mise configs for the session's working
# directory so `mise` can parse them without a manual `mise trust`. This matters
# most for freshly created git worktrees, where none of the repo's mise configs
# are trusted yet (mise keys trust by absolute path, so each new worktree path
# is untrusted even though the main checkout is trusted by scripts/setup.ts).
#
# SessionStart runs on every session, so this hook stays cheap in the common
# case (main checkout) and only does the full nested-config walk inside a linked
# worktree. Trusting is best-effort: a failure must never block the session, and
# plain stdout is fine here (the harness adds it to context).
set -euo pipefail

# The harness may invoke hooks with a minimal PATH; include the common mise
# install locations so `mise` resolves even when the login profile isn't sourced.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

command -v mise >/dev/null 2>&1 || exit 0

# SessionStart input JSON arrives on stdin (cat on empty/closed stdin returns 0).
input="$(cat)"

# Resolve the working dir: prefer the hook's cwd, then harness env, then PWD.
dir=""
if [ -n "$input" ] && command -v jq >/dev/null 2>&1; then
  dir="$(printf '%s' "$input" | jq -r '.cwd // empty')"
fi
[ -n "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -d "$dir" ] || exit 0

cd "$dir"

# Best-effort from here: never let a trust failure abort the session.
set +e

# Trust the working-dir config (and any parent configs) — one cheap call.
mise trust --yes --quiet --all >/dev/null

# Only walk nested per-package configs inside a linked worktree. In the main
# checkout scripts/setup.ts already trusts everything, so re-walking 70+ configs
# on every session start would be wasted work. A linked worktree has an absolute
# git-dir distinct from the common git-dir.
git_dir=""
common_dir=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git_dir="$(git rev-parse --absolute-git-dir)"
  common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
fi

count=0
if [ -n "$git_dir" ] && [ "$git_dir" != "$common_dir" ]; then
  while IFS= read -r cfg; do
    mise trust --yes --quiet "$cfg" >/dev/null
    count=$((count + 1))
  done < <(find "$dir" \
    \( -name node_modules -o -name .git -o -name archive -o -name dist -o -name build -o -name target \) -prune \
    -o -type f \( -name mise.toml -o -name .mise.toml \) -print)
  echo "Trusted mise configs in worktree $dir ($count nested)"
else
  echo "Trusted mise configs in $dir"
fi

exit 0
