# Durable Agent Sessions

## Status

Complete

Define a durable session and pull-request workflow for repository agents without executing lifecycle hooks in cloud or web sessions.

## Session Log - 2026-07-19

### Done

- Added the main-checkout log, worktree handoff, durable-context, and draft-PR policy to `AGENTS.md` and `CLAUDE.md`.
- Removed repository-local Claude Code, Codex, and OpenCode lifecycle hooks so cloud and web sessions cannot execute them.
- Updated `.gitignore` to ignore local `.claude/` and `.codex/` state.
- Opened draft PR #1579: `https://github.com/shepherdjerred/monorepo/pull/1579`.
- Audited user and repository configuration for Claude Code, Codex, and OpenCode. Claude and OpenCode user configuration is chezmoi-managed; Codex user configuration is unmanaged.

### Remaining

- Remove the stale Codex `[hooks.state]` records in `~/.codex/config.toml` that reference the deleted repository hook and removed `~/.codex/hooks.json`, if the user wants the live user configuration cleaned up.

### Caveats

- The durable workflow is prompt-based, so it applies consistently across terminal and cloud agents without executing machine-specific commands.
- PR #1579 remains draft pending workflow review.
- User-level instructions are intentionally cross-repository only. The monorepo-specific session, worktree, log, and PR policy belongs in repository `AGENTS.md`.
