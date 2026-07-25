#!/usr/bin/env bash
# Nudge local CLI sessions in the main checkout. Hosted Claude and Codex
# environments exit before inspecting or changing their managed filesystem.
set -euo pipefail

tool="claude"
for arg in "$@"; do
  case "$arg" in
    --tool=*) tool="${arg#--tool=}" ;;
  esac
done

if [ "$tool" = "claude" ] && [ -n "${CLAUDE_CODE_REMOTE:-}" ]; then
  exit 0
fi
if [ "$tool" = "codex" ] && { [ -n "${CODEX_CI:-}" ] || [ -n "${CODEX_CLOUD_TASKS_BASE_URL:-}" ]; }; then
  exit 0
fi

input="$(cat)"
src=""
dir=""
if [ -n "$input" ] && command -v jq >/dev/null 2>&1; then
  src="$(printf '%s' "$input" | jq -r '.source // empty')"
  dir="$(printf '%s' "$input" | jq -r '.cwd // empty')"
elif [ -n "$input" ]; then
  exit 0
fi
[ -n "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -d "$dir" ] || exit 0

case "$src" in
  resume | compact) exit 0 ;;
esac

cd "$dir"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git_dir="$(git rev-parse --absolute-git-dir)"
common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
[ "$git_dir" = "$common_dir" ] || exit 0

message="$(cat <<'EOF'
Worktree reminder: this session is in the main checkout.

Before your first edit on a non-trivial change, create a worktree:

  git worktree add .claude/worktrees/<slug> -b feature/<slug> origin/main
  cd .claude/worktrees/<slug>
  mise trust -y --all

The worktree holds a git-spice *stack* — every feature PR is a stacked PR. Manage
branches and PRs with git-spice (`gs`) and load the `git-spice-helper` skill before
any branch/PR op. (In scripts, `gs` is Ghostscript — call `git-spice`.)

Only stay in main for a single-file, single-commit fix you will not put in a PR.
EOF
)"

if [ "$tool" = "codex" ] && command -v jq >/dev/null 2>&1; then
  jq -n --arg ctx "$message" \
    '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
else
  printf '%s\n' "$message"
fi
