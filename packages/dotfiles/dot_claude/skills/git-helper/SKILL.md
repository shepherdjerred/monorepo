---
name: git-helper
description: |
  Git version control best practices, advanced operations, and modern features
  When user works with git, mentions git commands, branching, rebasing, merging, or git troubleshooting
---

# Git Helper Agent

## What's New in Git (2024-2026)

### Git 2.52 (2025)
- **`git last-modified`**: New command to determine which commit most recently modified each file in a directory (5.5x faster than ls-tree + log)
- **`git refs list` / `git refs exists`**: Consolidated reference operations
- **`git repo`**: Experimental command for retrieving repository information
- **`git maintenance` geometric task**: Alternative to all-into-one repacks
- **`git sparse-checkout clean`**: Recover from difficult checkout state transitions
- **Default branch change**: Git 3.0 will default to "main" instead of "master"
- **Rust integration**: Optional Rust code for variable-width integer operations
- **`git describe` 30% faster**, `git log -L` faster for merge commits

### Git 2.51 (2025)
- **Stash interchange format**: `git stash export` and `git stash import` subcommands for cross-machine stash migration
- **`--path-walk` repacking**: Significantly smaller pack files by emitting all objects from a given path simultaneously
- **Cruft-free multi-pack indexes**: 38% smaller MIDXs, 35% faster writes, 5% better read performance at GitHub
- **`git switch` / `git restore`**: No longer experimental after six years
- **`git whatchanged`**: Marked for removal in Git 3.0

### Git 2.50 (2025)
- **ORT merge engine**: Completely replaced the older recursive merge engine
- **`git merge-tree --quiet`**: Check mergeability without writing objects
- **`git maintenance` new tasks**: `worktree-prune`, `rerere-gc`, `reflog-expire`
- **Incremental multi-pack bitmap support**: Fast reachability bitmaps for extremely large repos
- **`git cat-file` object filtering**: Filter objects by type using partial clone mechanisms
- **Bundle URI**: Faster fill-in fetches by advertising all known references from bundles

### Git 2.49 (2025)
- **Name-hash v2**: Dramatically improved packing (fluentui: 96s to 34s, 439 MiB to 160 MiB)
- **`git backfill`**: Batch-fault missing blobs in `--filter=blob:none` partial clones
- **zlib-ng support**: ~25% speed improvement for compression
- **`git clone --revision`**: Clone specific commits without branch/tag references
- **`git gc --expire-to`**: Manage pruned objects by moving them elsewhere
- **First Rust code integration** via libgit-sys and libgit crates

### Git 2.48 (2025)
- **Faster checksums**: 10-13% performance improvement in serving fetches/clones using non-collision-detecting SHA-1 for trailing checksums
- **`range-diff --remerge-diff`**: Review merge conflict resolutions during rebase
- **Remote HEAD tracking**: Fetch auto-updates `refs/remotes/origin/HEAD` if missing; configure `remote.origin.followRemoteHead`
- **Meson build system**: Alternative build system alongside Make/CMake/Autoconf
- **Memory leak elimination**: Entire test suite passes with leak checking
- **`BreakingChanges.txt`**: Documents anticipated deprecations for future versions

### Git 2.47 (2024)
- **Incremental multi-pack indexes**: Layered MIDX chains for faster object addition
- **Separate hash function for checksums**: 10-13% serving performance improvement

### Git 2.46 (2024)
- **Pseudo-merge bitmaps**: Faster reachability queries
- **`git config list` / `git config get`**: New sub-command interface
- **Reftable migration**: `git refs migrate --ref-format=reftable` for faster reference operations
- **Enhanced credential helpers**: authtype/credential fields, multi-round auth (NTLM, Kerberos)

### Git 2.45 (2024)
- **Reftable backend**: New reference storage with faster lookups, reads, and writes

### Git 2.44 (2024)
- **Multi-pack reuse optimization**: Faster fetches and clones
- **`builtin_objectmode` pathspec**: Filter paths by mode

## Overview

Git is the distributed version control system used by virtually all modern software projects. This skill covers general Git best practices, advanced operations, branching strategies, and modern features. For worktree-specific workflows (parallel development, AI agent isolation), see the `worktree-workflow` skill instead.

## CLI Commands

### Auto-Approved (Safe, Read-Only)

These commands are safe to run without user confirmation:
- `git status` - Working tree status
- `git log` - Commit history (with `--oneline`, `--graph`, `--all`, `--since`, `--author`)
- `git diff` - Show changes (staged: `--cached`, between branches, specific files)
- `git branch` - List branches (`-a` for all, `-v` for verbose, `--merged`, `--no-merged`)
- `git tag` - List tags (`-l "v1.*"` for patterns)
- `git show` - Show commit details
- `git remote -v` - List remotes
- `git stash list` - List stashed changes
- `git reflog` - Reference log history
- `git blame` - Line-by-line authorship
- `git shortlog` - Summarized log output
- `git config --list` - Show configuration
- `git rev-parse` - Parse revision/path info
- `git ls-files` - Show tracked files
- `git describe` - Human-readable name from commit

### Common Operations

```bash
# Stage changes
git add <file>              # Stage specific file
git add -p                  # Interactive staging (hunk-by-hunk)
git add -N <file>           # Track file without staging content

# Commit
git commit -m "message"     # Commit with message
git commit --amend          # Amend last commit (message or content)
git commit --fixup=<sha>    # Create fixup commit for later autosquash
git commit --allow-empty    # Empty commit (useful for CI triggers)

# Branch operations
git branch <name>           # Create branch
git branch -d <name>        # Delete merged branch
git branch -D <name>        # Force delete branch
git branch -m <old> <new>   # Rename branch
git switch <branch>         # Switch branch (preferred over checkout)
git switch -c <new-branch>  # Create and switch

# Remote operations
git fetch                   # Fetch from default remote
git fetch --all --prune     # Fetch all remotes and prune stale tracking
git pull --rebase           # Pull with rebase instead of merge
git push -u origin <branch> # Push and set upstream

# Undoing changes
git restore <file>          # Discard working tree changes (preferred over checkout --)
git restore --staged <file> # Unstage file
git reset --soft HEAD~1     # Undo last commit, keep changes staged
git reset --mixed HEAD~1    # Undo last commit, keep changes unstaged
git revert <sha>            # Create a new commit that undoes a previous commit
```

### Log and History

```bash
# Useful log formats
git log --oneline --graph --all --decorate
git log --since="2 weeks ago" --author="name"
git log --follow -p -- <file>       # Full history of a file including renames
git log -S "search_string"          # Find commits that add/remove a string (pickaxe)
git log -G "regex_pattern"          # Find commits matching regex in diffs
git log --first-parent              # Follow only first parent (clean merge history)
git log --diff-filter=D -- <path>   # Find when files were deleted

# Comparing
git diff main..feature              # Changes in feature not in main
git diff main...feature             # Changes since feature branched from main
git diff --stat                     # Summary of changes
git diff --name-only                # Just filenames
git diff --word-diff                # Word-level diff
```

## Essential Workflows

### Creating Good Commits

1. **Atomic commits**: Each commit should represent one logical change
2. **Write clear messages**: Follow conventional commit format
   ```
   type(scope): short description

   Longer explanation if needed. Wrap at 72 characters.

   Refs: #123
   ```
   Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`
3. **Stage intentionally**: Use `git add -p` to review each hunk
4. **Verify before committing**: Run `git diff --cached` to review staged changes

### Syncing with Upstream

```bash
# Rebase approach (linear history)
git fetch origin
git rebase origin/main

# If conflicts arise during rebase
git status                  # See conflicted files
# ... resolve conflicts ...
git add <resolved-files>
git rebase --continue       # Continue after resolving
git rebase --abort          # Abort and return to pre-rebase state

# Merge approach (preserves branch topology)
git fetch origin
git merge origin/main
```

### Cleaning Up Before PR

```bash
# Interactive rebase to clean commit history
git rebase -i origin/main

# With autosquash (processes fixup!/squash! commits automatically)
git rebase -i --autosquash origin/main

# Enable autosquash globally
git config --global rebase.autoSquash true
```

### Recovering from Mistakes

```bash
# Find lost commits or states
git reflog                          # Show recent HEAD movements
git reflog show <branch>            # Show branch-specific reflog

# Recover after bad rebase/reset
git reset --hard HEAD@{2}           # Reset to state 2 moves ago

# Recover deleted branch
git reflog | grep "checkout.*branch-name"
git branch <branch-name> <sha>      # Recreate from found SHA
```

## When to Ask for Help

Ask the user for clarification when:
- Choosing between rebase vs merge strategy for their team
- Whether to force push after rebase (check if others use the branch)
- How to handle complex merge conflicts
- Repository-specific branching conventions
- Whether to squash commits before merging

## References

- [Git Official Documentation](https://git-scm.com/doc)
- [Git Release Notes](https://github.com/git/git/tree/master/Documentation/RelNotes)
- [GitHub Blog - Git Updates](https://github.blog/open-source/git/)
- [Pro Git Book](https://git-scm.com/book/en/v2)
- [Conventional Commits](https://www.conventionalcommits.org/)

### Skill References

For detailed coverage of specific topics, see:
- `references/advanced-operations.md` - Interactive rebase, bisect, reflog, cherry-pick, filter-repo, stash, rerere, blame, notes, bundle, sparse-checkout
- `references/branching-workflows.md` - Branching strategies, commit conventions, merge vs rebase, signed commits, tags, release workflows
- `references/config-hooks.md` - Git configuration, conditional includes, aliases, hooks, maintenance, scalar, performance, .gitattributes, .gitignore
