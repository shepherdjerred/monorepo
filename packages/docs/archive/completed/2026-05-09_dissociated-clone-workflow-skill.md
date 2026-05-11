# Dissociated-Clone Workflow Skill

## Status

Complete

## Context

Worktrees share `refs/stash`, the reflog, and other per-repo state across checkouts. Stashing is sometimes unavoidable (e.g., merges that require a clean tree), so collisions are real — especially during parallel feature work or multi-agent Claude runs in this monorepo.

The fix is `git clone --shared --dissociate`: bootstraps with no network from a local source's objects, then copies the needed objects into the new clone and detaches. Result: a fully independent clone — own `.git`, own stash, own reflog, safe to gc, source repo can be deleted without breaking it. The only post-clone fixup is re-pointing `origin` from the local path to the real remote.

This change adds a global skill teaching the workflow, deprecates the existing worktree skill in favour of it, and updates the monorepo's `CLAUDE.md` to direct Claude to prefer dissociated clones for parallel work — including a prominent reminder to run `bun run scripts/setup.ts` in the new clone before any build/test.

## Decisions

| Decision           | Choice                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Skill name         | `dissociated-clone-workflow`                                                                           |
| Primary command    | `git clone --shared --dissociate <local>` + `git remote set-url origin <remote>` + `git fetch --prune` |
| Clone layout       | Sibling style: `~/git/monorepo-<feature-slug>`                                                         |
| Old worktree skill | Deprecated (top-of-file note pointing to new skill, content preserved)                                 |

## Files

| File                                                                 | Change                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.claude/skills/dissociated-clone-workflow/SKILL.md`               | Created — mirrors the worktree-workflow skill structure with clone-specific commands and a "why not worktrees?" section                                                   |
| `~/.claude/skills/worktree-workflow/SKILL.md`                        | Modified — deprecation note added below frontmatter pointing to the new skill                                                                                             |
| `/Users/jerred/git/monorepo/CLAUDE.md`                               | Modified — new `## Parallel Work — Prefer Dissociated Clones` section between `## Verification` and `## Package Notes`, with explicit `bun run scripts/setup.ts` reminder |
| `packages/docs/plans/2026-05-09_dissociated-clone-workflow-skill.md` | This file                                                                                                                                                                 |
| `packages/docs/index.md`                                             | Plan entry added                                                                                                                                                          |

## Workflow Smoke Test (run during planning)

Verified against `/Users/jerred/git/monorepo` before writing the skill:

| Check                                | Result                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `git clone --shared --dissociate`    | Succeeds; ~2 min for working-tree checkout (no network)                                                                 |
| `.git` size after dissociate         | 485 MB (own object store)                                                                                               |
| `.git/objects/info/alternates`       | Absent — dissociate severed the link                                                                                    |
| `git fsck --no-dangling`             | Clean                                                                                                                   |
| Stash isolation                      | Verified — stash created in clone did not appear in source's `git stash list`                                           |
| Reflog isolation                     | Verified — clone's reflog is its own, source unchanged                                                                  |
| `git remote set-url origin <github>` | Works as expected                                                                                                       |
| Ref bleed from non-bare source       | Real — local branches in source appear as `remotes/origin/*`. Mitigated by `git fetch origin --prune` after re-pointing |

## Verification

Documentation/skill content only — no runtime to test. To verify in a future session:

1. Confirm the new skill appears in the Claude skills list (`dissociated-clone-workflow`).
2. Confirm the worktree skill shows the deprecation note immediately under the frontmatter.
3. Confirm `CLAUDE.md` shows the new `Parallel Work — Prefer Dissociated Clones` section between `## Verification` and `## Package Notes`.
4. Optional smoke test:

   ```bash
   git clone --shared --dissociate /Users/jerred/git/monorepo /tmp/monorepo-test
   cd /tmp/monorepo-test
   ls .git/objects/info/                    # expect: no `alternates` file
   git remote -v                            # expect: origin = local path
   git remote set-url origin <github-url>
   git fetch origin --prune
   git stash list                           # expect: empty (independent stash)
   du -sh .git                              # expect: ~485 MB
   rm -rf /tmp/monorepo-test
   ```

## Session Log — 2026-05-09

### Done

- Created `~/.claude/skills/dissociated-clone-workflow/SKILL.md` mirroring the structure of the worktree-workflow skill, with sections: why-not-worktrees, overview, core concept, CLI commands, complete workflow, advanced patterns, AI agent workflows, integration with PR workflow, best practices, common workflows, troubleshooting.
- Added a deprecation note to `~/.claude/skills/worktree-workflow/SKILL.md` directing readers to the new skill.
- Added `## Parallel Work — Prefer Dissociated Clones` to `/Users/jerred/git/monorepo/CLAUDE.md`, including an explicit `bun run scripts/setup.ts` reminder.
- Mirrored plan to `packages/docs/plans/2026-05-09_dissociated-clone-workflow-skill.md` and updated `packages/docs/index.md`.
- Smoke-tested the workflow end-to-end against `/Users/jerred/git/monorepo` in `/tmp/monorepo-shared-test` (cleaned up).
- Mirrored both skill changes into chezmoi source via `chezmoi re-add` (worktree-workflow) and `chezmoi add` (dissociated-clone-workflow). Verified `diff` between live `~/.claude/skills/<name>/SKILL.md` and `packages/dotfiles/dot_claude/skills/<name>/SKILL.md` is clean for both skills.

### Remaining

- None for this scope.

### Caveats

- The skill recommends `--shared` (purely local) over `--reference <remote>` (which would set `origin` correctly out of the box) because the user prefers no network during the bootstrap. The trade-off is mandatory `git remote set-url origin <real-remote>` + `git fetch origin --prune` after clone — both documented prominently.
- Cloning from a non-bare source brings local-only branches over as `remotes/origin/*` refs (e.g., `worktree-*` branches from prior worktree experiments). `git fetch origin --prune` after re-pointing the remote drops them.
- Each clone needs ~20 GB after `bun run scripts/setup.ts` populates `node_modules`, generated files, and Rust `target/`. The trade-off is called out in CLAUDE.md and the skill.
- The old `worktree-workflow` skill is deprecated but not deleted. The user may delete it later if dissociated clones fully replace worktree usage in their workflow.
