---
id: log-2026-08-05-remove-worktree-mechanisms
type: log
status: complete
board: false
---

# Remove worktree mechanisms

## Objective

Remove the repository and dotfile worktree-specific prompts, hooks, launchers,
and editor setup mechanisms while preserving unrelated agent safety and provider
configuration.

## Removed controls

- Removed the Claude Code SessionStart hooks and their mise-trust and worktree
  reminder scripts.
- Removed the Codex SessionStart configuration and OpenCode worktree-reminder
  plugin.
- Removed the root worktree-first policy, worktree setup sequence, and
  worktree-only path rules. Session records now belong in the active checkout.
- Removed Cursor's package-level worktree setup manifests, Zed's
  `trust_all_worktrees` preference, and the personal `claude-worktree` launcher.
- Removed the dotfile-source and installed `worktree-workflow` skill, plus the
  matching worktree assumptions from the git-spice documentation.
- Removed the deleted shell-hook entries from `scripts/script-migrations.json`.

## Preserved boundaries

The change intentionally retains git-spice as the feature-branch and stacked-PR
tool, general Git worktree support, historical records, and runtime worktree
usage that belongs to independent products such as the PR fleet controller.
They are not prompts or enforcement mechanisms for the interactive development
workflow.

## Session Log — 2026-08-05

### Done

- Removed the repository and dotfile worktree-specific prompts, startup hooks,
  editor hooks, launcher, and agent skill.
- Updated the root and git-spice guidance so feature branch management no longer
  depends on a linked worktree.
- Removed the live installed worktree skill as well as its chezmoi source.
- Published the resulting change as draft PR #1999.

### Remaining

- No implementation work remains.

### Caveats

- Existing linked worktrees and their uncommitted work were preserved; no
  worktree directories or feature branches were deleted.
- The OpenCode dependency manifest and lockfile are untracked local files, so
  they were left untouched after the tracked plugin was removed.
- Verification passed: `bun run check-todos` and
  `bun run check-script-migrations`.
- Git-spice required clearing the raw branch's mistaken `origin/main` upstream
  before it could create the draft PR.
