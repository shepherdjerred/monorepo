# Claude Conversation Audit → Effectiveness Fixes

## Status

Complete

## Context

Audited all Claude conversations in `~/.claude` (1,432 logs, 921 MB) to find what makes
Claude less effective, condensed the findings, and applied fixes. Most artifacts live in
personal config (`~/.zshenv`, `~/AGENTS.md`, `~/.claude/.../memory/`); the only monorepo
change is `packages/dotfiles/dot_zshenv` (this PR, #1347).

## Method

Direct quantitative sweep (not agent sampling): correlated every `is_error` tool-result
(2,938 total) back to the command that caused it, and scanned 10,526 prompts for
corrections. Full plan/report: `~/.claude/plans/audit-my-claude-convos-sequential-neumann.md`.

## Top findings (by error volume)

| Theme                          | Errors | Root cause                                                                                                     |
| ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| zsh `nomatch` glob-abort       | ~650   | Bash tool runs **zsh**; unmatched globs (`out/*.tmp`, `config*`) abort the whole command. bash passes through. |
| Hand-rolled CI/PR polling      | ~560   | `sleep N && gh pr checks` — harness blocks sleep-then-command; exit-8 poll churn.                              |
| Edit-before-Read / Read misuse | ~600   | Out of scope — core Claude behavior.                                                                           |

## Fixes applied

1. **zsh `nomatch`** → created `~/.zshenv` with `setopt no_nomatch`; tracked in chezmoi as
   `packages/dotfiles/dot_zshenv` (this PR). Verified: `echo /tmp/no_such_glob_*.xyz` prints
   the literal with exit 0.
2. **Anti-polling rule** → added a "Waiting on CI/PRs/external state — never busy-poll"
   section to `~/AGENTS.md` (use `pr-monitor` / `Monitor` / background tasks instead of
   `sleep N && cmd`). Also deleted the stale `feedback_short_sleep` memory that told Claude
   to `sleep 30`-poll.
3. **MEMORY.md prune** → 151 → 140 files. Deleted 11: the whole Bazel cluster (repo is
   Bun-only; `no_outside_bazel` actively contradicted current practice), `short_sleep`,
   `docker_restart` (one-off), and two duplicates (`fix_root_cause`, `no_silent_skip`).
   Rewrote the index with one-line hooks, organized by category: **31.5 KB → 21.8 KB**
   (under the 24.4 KB cap that was causing partial loading), 140/140 indexed, 0 orphans.

## Session Log — 2026-06-28

### Done

- Audited 1,432 logs; produced report at `~/.claude/plans/audit-my-claude-convos-sequential-neumann.md`.
- Created `~/.zshenv` (`setopt no_nomatch`) + `packages/dotfiles/dot_zshenv` (PR #1347).
- Added anti-polling section to `~/AGENTS.md`.
- Pruned + condensed `~/.claude/projects/-Users-jerred-git-monorepo/memory/MEMORY.md`
  (140 files, 21.8 KB, 0 orphans); deleted 11 stale/duplicate memory files.

### Remaining

- Merge PR #1347; run `chezmoi apply` on other machines to propagate `~/.zshenv`.
- Optional: a fresh-session check that the "MEMORY.md partially loaded" warning is gone.

### Caveats

- The shell-override is not a documented Claude Code setting; the fix relies on zsh sourcing
  `~/.zshenv` for the non-interactive Bash tool (verified working this session).
- Dropped by user decision: Read/Edit-before-Read hygiene (core behavior) and a worktree
  write-guard hook (worktree behavior already satisfactory).
