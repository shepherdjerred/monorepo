# Worktree mise trust hook fix

## Status

Complete

## Summary

Claude Code's `WorktreeCreate` hook is not a post-create notification. Per the
Claude Code hooks documentation, defining it replaces the default git worktree
creation behavior and requires the hook to print the absolute path of the
created worktree on stdout. This repo only needs to trust mise after Claude has
entered the workspace, so the hook is registered on `SessionStart` instead.

## Session Log — 2026-06-06

### Done

- Checked the official Claude Code hooks documentation for `WorktreeCreate`
  semantics.
- Moved `.claude/settings.json` hook registration from `WorktreeCreate` to
  `SessionStart` with the `startup|resume` matcher.
- Updated `.claude/hooks/trust-mise.sh` to remain trust-only: it reads the hook
  `cwd`, falls back to `$CLAUDE_PROJECT_DIR` / `$PWD`, and runs the root plus
  nested mise trust pass without creating or removing worktrees.
- Verified shell syntax with `bash -n .claude/hooks/trust-mise.sh`.
- Verified `.claude/settings.json` with `jq`.
- Verified the trust-only `SessionStart` hook with stdin JSON for this
  worktree. The escalated verification succeeded silently, which is expected for
  `SessionStart`.
- Published branch `codex/claude-mise-sessionstart-hook`.
- Opened draft PR
  [`#1025`](https://github.com/shepherdjerred/monorepo/pull/1025).

### Remaining

- None.

### Caveats

- `SessionStart` with `startup|resume` runs when Claude starts or resumes in a
  workspace rather than only at worktree creation. `mise trust` is idempotent,
  so this keeps Claude's default worktree creation behavior intact while still
  handling fresh absolute paths.
