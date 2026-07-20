---
id: nonblocking-agent-hooks
type: log
status: complete
board: false
---

# Durable Agent Sessions

Define a durable session and pull-request workflow for repository agents without executing lifecycle hooks in cloud or web sessions.

## Session Log - 2026-07-19

### Done

- Added the main-checkout log, worktree handoff, durable-context, and draft-PR policy to `AGENTS.md` and `CLAUDE.md`.
- Restored non-blocking repository-local Claude Code, Codex, and OpenCode lifecycle hooks. Claude hooks skip `CLAUDE_CODE_REMOTE`; Codex hooks skip hosted-task environment markers.
- Updated `.gitignore` to ignore local `.claude/` and `.codex/` state.
- Opened draft PR #1579: `https://github.com/shepherdjerred/monorepo/pull/1579`.
- Audited user and repository configuration for Claude Code, Codex, and OpenCode. Claude and OpenCode user configuration is chezmoi-managed; Codex user configuration is unmanaged.
- Removed stale Codex hook-trust records from the unmanaged `~/.codex/config.toml`.

### Remaining

- None.

### Caveats

- The durable workflow is prompt-based for all agents, with supplemental lifecycle hooks only for local CLI runtimes.
- PR #1579 remains draft pending workflow review.
- User-level instructions are intentionally cross-repository only. The monorepo-specific session, worktree, log, and PR policy belongs in repository `AGENTS.md`.
