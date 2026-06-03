# Auto-trust mise configs on new git worktrees

## Status

Complete

## Goal

When Claude Code creates a new git worktree, `mise` configs (`.mise.toml` /
`mise.toml`) land at fresh absolute paths and show as `untrusted`, so `mise`
refuses to parse them until a manual `mise trust`. Automate the trust step,
checked into the repo so it travels with the project.

## Approach

A Claude Code **`WorktreeCreate`** hook (fires precisely when the harness
creates a worktree — unlike `SessionStart`, which would run on every session
everywhere) runs a small script that trusts the worktree's mise configs.

### Files

- `.claude/settings.json` — project config registering the `WorktreeCreate`
  hook. Command: `"$CLAUDE_PROJECT_DIR/.claude/hooks/trust-mise.sh"`.
- `.claude/hooks/trust-mise.sh` — reads the worktree path from the hook's stdin
  JSON (falls back to `$CLAUDE_PROJECT_DIR` / cwd), runs `mise trust --all` at
  the root, then walks the tree and trusts each nested package `mise.toml`
  (each absolute path needs its own trust entry — mirrors `scripts/setup.ts`).
  No-ops if `mise` is absent.
- `.gitignore` — the old `/.claude/` (trailing-slash dir exclusion) made the
  pre-existing `!/.claude/settings.json` negation **ineffective**, because git
  cannot re-include a file whose parent directory is excluded. Switched to
  `/.claude/*` and added negations so only `settings.json` and
  `hooks/trust-mise.sh` are tracked; `settings.local.json`, `worktrees/`, and
  everything else under `.claude/` stay ignored.

## Verification

- `git check-ignore` confirms the two files are tracked-eligible and that
  `settings.local.json` / `worktrees/` remain ignored.
- `git add -n .claude/` stages exactly the two intended files.
- Pipe-tested the script against this worktree: flipped the root and nested
  package configs (e.g. `scout-for-lol`) from `untrusted` to `trusted`.
- `jq` validates `settings.json` and confirms the hook command.

## Session Log — 2026-05-30

### Done

- Added `.claude/settings.json` (project `WorktreeCreate` hook).
- Added `.claude/hooks/trust-mise.sh` (executable).
- Restructured the `.gitignore` `.claude/` block to track only those two files.
- Reverted an earlier global-settings version of the hook (`~/.claude/`), so
  the in-repo copy is the single source.

### Remaining

- Files are staged-eligible but not committed (no commit was requested). Commit
  when ready: `.claude/settings.json`, `.claude/hooks/trust-mise.sh`, `.gitignore`.
- Only covers Claude-Code-created worktrees. Manual `git worktree add` from a
  shell would need a git `post-checkout` hook (via lefthook) — not implemented.

### Caveats

- Project hooks from `settings.json` require the usual Claude Code hook trust;
  the config watcher may need a `/hooks` open or restart to pick up the new
  file on the very first session after it lands.
