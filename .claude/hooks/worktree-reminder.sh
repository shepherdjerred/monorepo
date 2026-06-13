#!/usr/bin/env bash
# SessionStart hook: when a session starts in the MAIN checkout, nudge the agent
# to create a git worktree before editing. Pure reminder — it never blocks and
# always exits 0. The text mirrors the bright-line rule in AGENTS.md
# ("Parallel Work — Use Worktrees"); keep the two in sync.
#
# Output formats differ by tool:
#   - Claude Code injects a hook's plain stdout into the session context, so the
#     default path just prints the reminder (same as the sibling trust-mise.sh).
#   - Codex consumes a JSON envelope (hookSpecificOutput.additionalContext), so
#     its hook passes --tool=codex to select that format.
set -euo pipefail

tool="claude"
for arg in "$@"; do
  case "$arg" in
    --tool=*) tool="${arg#--tool=}" ;;
  esac
done

# SessionStart input JSON arrives on stdin (cat on empty/closed stdin returns 0).
input="$(cat)"

# Resolve source + working dir from the payload (jq if available), else fall back.
src=""
dir=""
if [ -n "$input" ] && command -v jq >/dev/null 2>&1; then
  src="$(printf '%s' "$input" | jq -r '.source // empty')"
  dir="$(printf '%s' "$input" | jq -r '.cwd // empty')"
fi
[ -n "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -d "$dir" ] || exit 0

# Only nudge on a genuinely new session — not on resume/compact — to avoid nagging.
case "$src" in
  resume | compact) exit 0 ;;
esac

cd "$dir"

# Nothing to nudge about outside a git work tree.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# A linked worktree has an absolute git-dir distinct from the common git-dir.
# If we're already in one, the agent is isolated — stay silent.
git_dir="$(git rev-parse --absolute-git-dir)"
common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
if [ "$git_dir" != "$common_dir" ]; then
  exit 0
fi

# In the main checkout: emit the reminder.
message="$(cat <<'EOF'
⚠ Worktree reminder — this session is in the MAIN checkout.

Before your FIRST edit on any non-trivial change — anything you'll open a PR for,
anything touching more than one file, or any multi-step task — create a worktree:

  git worktree add .claude/worktrees/<slug> -b feature/<slug> origin/main
  cd .claude/worktrees/<slug>
  bun run scripts/setup.ts   # REQUIRED before build/test in a fresh worktree

Only stay in the main checkout for a single-file, single-commit fix you won't PR.
When unsure, make the worktree. (Tip: `claude -w <slug>` does this at launch.)
EOF
)"

if [ "$tool" = "codex" ]; then
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg ctx "$message" \
      '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
  else
    printf '%s\n' "$message"
  fi
else
  printf '%s\n' "$message"
fi

exit 0
