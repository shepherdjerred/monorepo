# WorktreeCreate hook "no output" failure

## Status

Complete

## Problem

Creating a git worktree from Claude Code failed with:

```
WorktreeCreate hook failed: "$CLAUDE_PROJECT_DIR/.claude/hooks/trust-mise.sh": no output
```

This blocked worktree creation entirely.

## Root cause

The `WorktreeCreate` hook (`.claude/hooks/trust-mise.sh`) could finish — or
silently `exit 0` — without writing anything to stdout. The harness treats an
empty stdout from this hook as a hard failure ("no output").

Two no-output paths existed:

1. The harness runs hooks with a minimal environment, so `mise` was frequently
   not on `PATH`. The guard `command -v mise … || exit 0` then exited zero with
   no output.
2. The normal success path printed nothing either.

The script appeared to work when run manually only because an interactive shell
sources the login profile (putting `mise` on `PATH`).

## Fix

`.claude/hooks/trust-mise.sh`:

- Added an `emit()` helper that prints a valid JSON object
  (`{"continue": true, "systemMessage": "…"}`) and is invoked on **every** exit
  path, so the hook never produces empty stdout.
- Prepended common mise install locations (`~/.local/bin`, `/opt/homebrew/bin`,
  `/usr/local/bin`) to `PATH` so `mise` resolves without a sourced profile.

## Verification

- Normal path: valid JSON, exit 0.
- mise-missing path (`env -i`): valid JSON, exit 0.
- Output validated with `jq`.
- Executable bit preserved.

## Session Log — 2026-06-05

### Done

- Rewrote `.claude/hooks/trust-mise.sh` to always emit JSON and to augment `PATH`.
- Verified all exit paths produce parseable JSON + exit 0.

### Remaining

- The three existing `.claude/worktrees/*` checkouts carry stale copies of the
  old script. They don't affect new worktree creation from the main checkout, so
  they were left as-is (disposable). Refresh or remove them if reused.

### Caveats

- None. Fix is isolated to the hook script.
