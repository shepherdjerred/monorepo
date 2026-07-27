---
id: log-opencode-worktree-reminder-2026-07-27
type: log
status: complete
board: false
---

# OpenCode Worktree Reminder

Confirmed that the OpenCode warning is emitted by the repository-local plugin
`.opencode/plugins/worktree-reminder.js`. It compares Git's absolute directory
and common directory; equality means OpenCode is running in the main checkout
rather than a linked worktree. The plugin now adds the reminder to agent system
context instead of displaying a user-facing toast.

The reminder enforces the repository workflow documented in `AGENTS.md`: use a
linked worktree for non-trivial or PR-bound work, while small single-file changes
that will not become a PR may remain in the main checkout.

## Session Log — 2026-07-27

### Done

- Traced the displayed message to `.opencode/plugins/worktree-reminder.js`.
- Confirmed the equivalent Claude and Codex reminder integrations.
- Established that the previous OpenCode implementation rendered the reminder
  as a user-facing TUI toast rather than agent context.
- Replaced the OpenCode TUI toast with an agent system-context reminder.
- Verified that the main checkout receives one reminder and a linked worktree
  receives none.

### Remaining

- None.

### Caveats

- The reminder is advisory; it does not create or switch to a worktree.
- OpenCode must be restarted before the plugin change takes effect.
