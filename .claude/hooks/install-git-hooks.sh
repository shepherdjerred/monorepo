#!/usr/bin/env bash
# Claude Code SessionStart hook: make sure the repo's Lefthook git hooks are
# installed for the session's working directory. This matters most for freshly
# created git worktrees and fresh clones, where a commit could otherwise slip
# through with no pre-commit / commit-msg checks running.
#
# How hooks reach a worktree: `lefthook install` (run by the root package.json
# `prepare` script during `bun install` / scripts/setup.ts) writes the hook
# scripts into the common .git/hooks dir and sets `core.hooksPath`. New worktrees
# inherit `core.hooksPath` from the shared config, so hooks normally fire without
# any per-worktree step. This hook is the safety net: if `core.hooksPath` is unset
# or the hook scripts are missing (e.g. a brand-new clone whose main checkout was
# never `bun install`-ed, or a wiped hooks dir), it runs `lefthook install` so the
# very first commit in the session is still gated.
#
# SessionStart runs on every session, so the common case (hooks already wired up)
# must stay cheap — a couple of `git config` reads and an early exit. We only look
# for a `lefthook` runner when hooks are actually missing, so an environment with
# no lefthook on PATH but with hooks already inherited (the usual worktree case)
# never pays for it. When install IS needed and `lefthook` isn't on PATH, fall back
# to `bunx`/`npx lefthook` (the npm package ships prebuilt binaries). Installing is
# best-effort: a failure must never block the session, and plain stdout is fine
# (the harness folds it into context).
set -euo pipefail

# The harness may invoke hooks with a minimal PATH; include the common install
# locations so `lefthook` / `git` / `bun` resolve even when the login profile
# isn't sourced.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

command -v git >/dev/null 2>&1 || exit 0

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

# Best-effort from here: never let a hook-install failure abort the session.
set +e

# Only act inside a git work tree.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# lefthook resolves its config from the repo root, so operate from there.
# We've already confirmed we're inside a work tree, so this won't error.
toplevel="$(git rev-parse --show-toplevel)"
[ -n "$toplevel" ] && cd "$toplevel"

# No lefthook config -> nothing to install (e.g. a repo that doesn't use it).
[ -f lefthook.yml ] || [ -f lefthook.yaml ] || [ -f .lefthook.yml ] || exit 0

# Determine where git will look for hooks: core.hooksPath wins, else $GIT_DIR/hooks.
# (`git rev-parse --git-path hooks` ignores core.hooksPath, so check the config first.)
# `git config --get` of an unset key exits non-zero with no stderr; under `set +e`
# that's harmless (empty result), and we're inside a work tree so neither errors.
hooks_dir="$(git config --get core.hooksPath)"
[ -n "$hooks_dir" ] || hooks_dir="$(git rev-parse --git-path hooks)"

# Cheap common-case exit: if the effective hooks dir already has the pre-commit
# hook, hooks are wired up (inherited core.hooksPath included) — do nothing.
if [ -n "$hooks_dir" ] && [ -f "$hooks_dir/pre-commit" ]; then
  echo "Git hooks already installed ($hooks_dir)"
  exit 0
fi

# Hooks missing or core.hooksPath unset: install them. Resolve a lefthook runner,
# preferring a binary on PATH and falling back to bun/npx (the `lefthook` npm
# package ships prebuilt binaries). `--yes` keeps npx non-interactive.
lefthook_runner=()
if command -v lefthook >/dev/null 2>&1; then
  lefthook_runner=(lefthook)
elif command -v bunx >/dev/null 2>&1; then
  lefthook_runner=(bunx lefthook)
elif command -v npx >/dev/null 2>&1; then
  lefthook_runner=(npx --yes lefthook)
else
  echo "Git hooks not installed: no 'lefthook' on PATH and no bun/npx fallback. Install lefthook (e.g. 'brew install lefthook') or run 'bun install' so commit hooks are gated."
  exit 0
fi

# `lefthook install` is idempotent and regenerates the shared hook scripts + sets
# core.hooksPath.
if "${lefthook_runner[@]}" install >/dev/null 2>&1; then
  echo "Installed Lefthook git hooks in $toplevel (via ${lefthook_runner[*]})"
else
  echo "Lefthook git hooks not installed (${lefthook_runner[*]} install failed; commit hooks may not run)"
fi

exit 0
