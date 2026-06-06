#!/usr/bin/env bash
# Claude Code WorktreeCreate hook: trust mise configs in a freshly created
# git worktree so `mise` can parse them without a manual `mise trust`.
#
# mise keys trust by absolute path, so every new worktree (and every nested
# package mise.toml inside it) needs its own trust entry. This mirrors the
# trust pass in scripts/setup.ts for the monorepo.
#
# The WorktreeCreate hook MUST emit JSON on stdout; an empty stdout is treated
# by the harness as a failed hook ("no output"). Every exit path below prints a
# JSON object via emit() so the hook always reports success.
set -euo pipefail

# Print a JSON result and exit 0. Argument is a plain-text status message.
emit() {
  printf '{"continue": true, "systemMessage": %s}\n' "$(json_str "$1")"
  exit 0
}

# JSON string escaper — avoids a jq dependency. Escapes backslash and double
# quote, encodes the JSON control-character escapes (\n \t \r), then strips any
# remaining C0 control chars (U+0000–U+001F) so the output is always valid JSON.
json_str() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/\\r}
  s=${s//$'\n'/\\n}
  s=$(printf '%s' "$s" | LC_ALL=C tr -d '\000-\010\013\014\016-\037')
  printf '"%s"' "$s"
}

# `set -e` is active for the `mise trust` calls below: if one exits non-zero
# (malformed mise.toml, permission error, a mise bug) bash would abort with no
# stdout — reproducing the exact "no output" failure this hook fixes. Trap any
# such error and emit JSON instead. Trusting configs is best-effort; a failure
# must never block worktree creation.
trap 'emit "mise trust hook error (line $LINENO): $BASH_COMMAND"' ERR

# The harness may invoke hooks with a minimal PATH; include the common mise
# install locations so `mise` resolves even when the login profile isn't sourced.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

command -v mise >/dev/null 2>&1 || emit "mise not found on PATH; skipped trust"

# Hook input JSON arrives on stdin; prefer an explicit worktree path from it,
# then fall back to the env the harness sets, then the current directory.
input="$(cat)"
dir=""
if command -v jq >/dev/null 2>&1; then
  dir="$(printf '%s' "$input" | jq -r '.worktree_path // .worktreePath // .path // .cwd // empty')"
fi
[ -n "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -d "$dir" ] || emit "worktree path not found; skipped trust"

cd "$dir"

# Trust the worktree root config (and any parent configs).
mise trust --yes --quiet --all

# Trust nested per-package mise configs; each absolute path needs its own entry.
count=0
while IFS= read -r cfg; do
  mise trust --yes --quiet "$cfg"
  count=$((count + 1))
done < <(find "$dir" \
  \( -name node_modules -o -name .git -o -name archive -o -name dist -o -name build -o -name target \) -prune \
  -o -type f \( -name mise.toml -o -name .mise.toml \) -print)

emit "Trusted mise configs in $dir ($count nested)"
