# Durable Agent Sessions

## Status

Complete

Define a durable session and pull-request workflow for repository agents without executing lifecycle hooks in cloud or web sessions.

## Session Log - 2026-07-19

### Done

- Added the main-checkout log, worktree handoff, durable-context, and draft-PR policy to `AGENTS.md` and `CLAUDE.md`.
- Removed repository-local Claude Code, Codex, and OpenCode lifecycle hooks so cloud and web sessions cannot execute them.
- Updated `.gitignore` to ignore local `.claude/` and `.codex/` state.

### Remaining

- None.

### Caveats

- The durable workflow is prompt-based, so it applies consistently across terminal and cloud agents without executing machine-specific commands.
