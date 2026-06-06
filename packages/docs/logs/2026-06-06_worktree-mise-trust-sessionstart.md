# Move mise-trust hook from WorktreeCreate to SessionStart

## Status

Complete

## Problem

Worktree creation failed at session start:

```
WorktreeCreate hook failed: hook must print an absolute path
(got "{"continue": true, "systemMessage": "Trusted mise configs in /Users/jerred/git/monorepo (72 nested)"}")
```

## Root cause

`.claude/hooks/trust-mise.sh` was registered on the `WorktreeCreate` event. Per the
[official hooks docs](https://code.claude.com/docs/en/hooks.md), `WorktreeCreate`
**replaces git's default worktree creation** — the command hook is expected to create
the worktree itself and print its absolute path on stdout ("Hook failure or missing
path fails creation"). A script that only trusts mise can never satisfy that contract:

- Before `3748f4bc7`: hook printed nothing → harness treated as "no output" failure.
- After `3748f4bc7`: hook printed JSON → harness rejected it ("must print an absolute path").

Either way it blocked worktree creation. The existing worktrees in `.claude/worktrees/`
were created manually via `git worktree add` (the CLAUDE.md workflow), never through this hook.

## Fix

Re-pointed the hook to the correct event, `SessionStart`, which fires when a session
starts (including inside a freshly created worktree), receives `cwd`, allows plain-text
stdout, and is non-blocking.

- `.claude/settings.json`: `WorktreeCreate` → `SessionStart`. This also restores default
  git worktree creation (no hook overriding it anymore).
- `.claude/hooks/trust-mise.sh`: reworked for SessionStart semantics:
  - Reads `cwd` from stdin (falls back to `CLAUDE_PROJECT_DIR`/`PWD`).
  - Always trusts the working-dir + parent configs (one cheap `mise trust --all`).
  - Only does the full nested-config walk inside a **linked worktree** (detected via
    `git --absolute-git-dir` ≠ `--git-common-dir`), since the main checkout is already
    trusted by `scripts/setup.ts`. Keeps the hook fast on every session start.
  - Best-effort: trust failures never abort the session; prints a plain status line.

## Verification

- Main checkout: cheap path, `Trusted mise configs in <dir>`, exit 0.
- Linked worktree: full walk, `Trusted mise configs in worktree <dir> (N nested)`, exit 0.
- Empty stdin: graceful fallback, exit 0.
- `shellcheck` clean, `settings.json` valid JSON, `prettier --check` passes.

## Session Log — 2026-06-06

### Done

- `.claude/settings.json` — switched hook registration from `WorktreeCreate` to `SessionStart`.
- `.claude/hooks/trust-mise.sh` — rewritten for SessionStart: cwd-based, worktree-gated nested walk, best-effort, plain-text stdout.
- Verified across main/worktree/empty-input cases; shellcheck + prettier + JSON validation pass.

### Remaining

- None. Change is uncommitted (no commit was requested).

### Caveats

- The new hook takes effect on the **next** session; the current session loaded the old `WorktreeCreate` config.
- Docs don't explicitly guarantee `SessionStart` fires inside harness-created (`isolation: worktree`) sessions. Even if it doesn't in some case, the change is strictly better: worktree creation is unblocked (default git behavior restored) and `scripts/setup.ts` still trusts mise as the documented worktree setup step.
- The nested walk re-runs on each session start within a worktree (idempotent). If this proves slow, add a once-per-worktree marker.
