---
name: git-helper
description: Safe, current Git operations for inspection, commits, history, recovery, merging, rebasing, worktrees, configuration, maintenance, and repository troubleshooting. Use for Git commands and diagnosis; load the repository's owning stack or branching skill before branch or PR mutations.
---

# Git Helper

Inspect first, preserve user work, and use the repository's owning branch workflow for mutations. This skill covers Git itself; a stack or PR skill remains authoritative for branch creation, restacking, publishing, and synchronization.

## Branch workflow ownership

In `shepherdjerred/monorepo`, every PR — human or agent, new or existing — is a git-spice stack. Load `git-spice-helper` first; it is authoritative for branch creation, restacking, and publishing.

Load `worktree-workflow` before creating an isolated worktree. Do not use a bare `gh pr create` or hand-written rebase in place of the owning stack tool.

## Current baseline

Verified against Git 2.55.0 on 2026-08-03:

```bash
git --version
```

Recent versions added stable `switch` and `restore`, stash export/import, `refs` commands, `last-modified`, `backfill`, `url-parse`, `format-rev`, maintenance improvements, and additional partial-clone and pack tooling. `repo`, `last-modified`, `history`, `format-rev`, and `backfill` should be treated according to their documented experimental or evolving status.

Git's future-breaking-changes document is the source of truth for planned removals. Do not state a Git 3 release date or default change as certain until the project publishes it.

Read [references/releases.md](references/releases.md) when adopting a recent command or upgrading Git. Read [references/history-and-recovery.md](references/history-and-recovery.md) for rebase, range-diff, bisect, reflog, stash, sparse checkout, bundles, and recovery. Read [references/configuration-and-maintenance.md](references/configuration-and-maintenance.md) for config, hooks, credentials, maintenance, refs, and repository health.

## Start read-only

Useful inspection commands:

```bash
git status --short --branch
git diff --stat
git diff
git diff --cached
git log --oneline --graph --decorate --all
git branch --verbose --verbose
git remote --verbose
git reflog
git worktree list --porcelain
git config --list --show-origin --show-scope
```

Use `git show <ref>:<path>`, `git log <ref> -- <path>`, and `git diff <base>...<head>` to inspect another branch without switching the working tree.

## Preserve concurrent work

- Never discard, stash, reset, restore, or switch away from unexpected work just to investigate.
- Treat every existing modification as user-owned unless provenance proves otherwise.
- Keep all agents read-only on history unless explicitly assigned an isolated branch mutation.
- Verify the current branch and recent movements before pushing:

```bash
git status --short --branch
git reflog -n 10
```

- Stage whole files by explicit path. Do not use interactive, hunk-level, current-directory, or repository-wide staging in agent workflows.

## Intentional commits

```bash
git add path/to/first path/to/second
git diff --cached --check
git diff --cached
git commit -m "type(scope): concise description"
```

If `core.fsmonitor` makes a changed file appear unstaged, compare the working and index object IDs and disable fsmonitor for the affected command:

```bash
git hash-object path/to/file
git rev-parse :path/to/file
git -c core.fsmonitor=false add path/to/file
```

Do not amend or force-push a commit another person may have based work on without explicit authorization.

## Compare the right ranges

```bash
# Tip-to-tip difference
git diff main..feature

# Changes introduced since the merge base
git diff main...feature

# Patch-series comparison before and after a rebase
git range-diff old-base..old-tip new-base..new-tip
```

`range-diff` compares two commit ranges. Do not use the invalid single-range shorthand found in older copies of this skill.

## Mergeability without changing the checkout

Use the repository's independent merge oracle when readiness matters:

```bash
git merge-tree --write-tree <base> <head>
```

Treat the exit status as the merge result: 0 is a clean merge, 1 is a real conflict. `--quiet` (Git 2.50+) additionally suppresses most output and object creation when the exit status is all that's needed, but isn't available on older Git — omit it rather than assume it exists, or gate it behind a version check. Do not replace this check with a checkout or an untrusted hosted mergeability field.

## Undo and recovery

Choose the least destructive operation:

| Goal | Operation | Boundary |
| --- | --- | --- |
| Undo a published commit | `git revert <commit>` | Adds a new inverse commit |
| Unstage a path | `git restore --staged <path>` | Keeps working-tree content |
| Recover a lost commit | inspect `git reflog`, then create a branch | Preserves the recovered object |
| Move a private branch while keeping changes | `git reset --soft` or `--mixed` after inspection | Rewrites only local branch position |
| Discard work | destructive reset/restore | Requires exact target resolution and explicit user intent |

Never present `git reset --hard HEAD@{n}` as a routine recovery recipe. First inspect the reflog entry and preserve it with a branch:

```bash
git reflog
git show <recovered-commit>
git branch recovery/<name> <recovered-commit>
```

## Rebasing and pushing

Use the owning stack tool for repositories with stacked PR workflows. In a generic repository, inspect the branch, fetch explicitly, and compare the rewritten series with `range-diff`.

Rebase does not always require a force push: an unpublished local branch can be pushed normally. When a published branch is intentionally rewritten, background fetches can invalidate the protection expected from plain `--force-with-lease`; verify the remote tip and use an explicit expected object when safety matters.

Never force-push main, release branches, shared branches, or work another person may have based on without current authorization.

## Hooks and credentials

Repository hooks are executable policy. Inspect the configured hook path and hook source before relying on them:

```bash
git config --get core.hooksPath
ls -la "$(git rev-parse --git-path hooks)"
```

`git config --get`/`--list` work on every supported Git version; the newer `git config get`/`git config list` subcommand syntax does not exist before Git 2.46. `git hook list <hook-name>` (added in Git 2.54, and it requires a hook name — it does not list every hook) can supplement this once the installed version is confirmed; do not rely on it as the portable default.

Use credential helpers or `GIT_ASKPASS`; never embed tokens in remotes, configuration, logs, or files. Treat hook input and filenames as untrusted shell data.

## Maintenance and repository health

Use `git maintenance` tasks documented for the installed version. `geometric-repack` is a maintenance task; `geometric` is a strategy, not a task name. Use `git maintenance is-needed` where supported to avoid unnecessary work.

For diagnosis:

```bash
git fsck --full
git count-objects -vH
git gc --auto
git reflog expire --dry-run --all
```

Do not change reflog expiry, run aggressive collection, or delete unreachable objects until recovery requirements and repository ownership are clear.

## Review checklist

- Load and obey the repository's owning stack/branch skill.
- Inspect status, diff, branch, and worktrees before mutation.
- Keep user-owned and concurrent work intact.
- Stage explicit whole-file paths and review the staged diff.
- Use independent merge-tree evidence for mergeability claims.
- Compare rewritten series with a valid two-range `range-diff`.
- Resolve exact reflog/reset/restore targets before destructive actions.
- Verify remote tips before any authorized history rewrite.
- Treat experimental commands and future Git changes as conditional.
- Check hook configuration and credential exposure before publishing.
