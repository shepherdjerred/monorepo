---
id: log-2026-05-30-remove-dissociated-clone-advice
type: log
status: complete
board: false
---

# Remove dissociated-clone advice — rely on worktrees

## Changes

- **`AGENTS.md`** — replaced the `## Parallel Work — Prefer Dissociated Clones` section with `## Parallel Work — Use Worktrees`. New flow: `git worktree add .claude/worktrees/<slug> -b feature/<slug> origin/main` → `bun run scripts/setup.ts` → `git worktree remove` + `git worktree prune` on cleanup. Points at the `worktree-workflow` skill.
- **`packages/dotfiles/dot_agents/skills/worktree-workflow/SKILL.md`** (chezmoi source) and **`~/.agents/skills/worktree-workflow/SKILL.md`** (live) — removed the top warning block that said "Prefer the `dissociated-clone-workflow` skill for new work."
- **Deleted the `dissociated-clone-workflow` skill** — `git rm` on the source (`packages/dotfiles/dot_agents/skills/dissociated-clone-workflow/SKILL.md`) and `rm -rf` on the live copy `~/.agents/skills/dissociated-clone-workflow` (`~/.claude/skills` is a symlink into `~/.agents/skills`, so both are gone). Skill no longer appears in the available-skills list.
- **Memories** — retargeted `feedback_team_isolated_workspace.md` and `feedback_own_clone_for_features.md` (and their `MEMORY.md` index lines) from dissociated clones to worktrees. The core lesson (never edit in the user's main checkout; isolate first) is unchanged — only the mechanism.

## Session Log — 2026-05-30

### Done

- Rewrote AGENTS.md parallel-work section to worktree-based guidance.
- Stripped the dissociated-clone preference banner from the `worktree-workflow` skill (source + live).
- Deleted the `dissociated-clone-workflow` skill (source via `git rm`; live copy removed).
- Updated two memories + MEMORY.md index to reference worktrees.
- Verified no `dissociat*` references remain in active (non-journal) repo docs.

### Remaining

- Nothing for this task. Changes are staged/unstaged in the worktree; not committed (user didn't ask to commit). The chezmoi source deletion will need a `chezmoi apply` on other machines, or it's already reconciled here since the live copy was removed directly.

### Caveats

- Historical journals (`packages/docs/archive/`, `plans/`, `logs/`) and `~/.claude` session transcripts still mention dissociated clones — intentionally left as point-in-time records; not rewritten.
- The user's global `~/.claude/CLAUDE.md` was not touched (it has no dissociated-clone advice).
