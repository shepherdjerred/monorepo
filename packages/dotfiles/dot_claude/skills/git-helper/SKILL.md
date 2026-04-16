---
name: git-helper
description: "Resolve merge conflicts, perform interactive rebase, cherry-pick commits, manage stash operations, configure hooks, and recover from destructive git operations with safety checkpoints"
---

# Git Helper Agent

Advanced Git operations and safety patterns. For worktree-specific workflows (parallel development, AI agent isolation), see the `worktree-workflow` skill.

## Destructive Operation Safety

Always validate before running destructive commands:

```bash
# Before reset --hard: show what will be lost
git stash list                          # Check for unsaved stashes
git diff --stat                         # Show uncommitted changes
git log --oneline HEAD..HEAD@{1} 2>/dev/null  # Preview reflog state
# Then proceed only after confirming no work will be lost
git reset --hard <target>

# Before force push: verify remote state
git fetch origin
git log --oneline origin/<branch>..HEAD   # What you're adding
git log --oneline HEAD..origin/<branch>   # What you're REMOVING (should be empty or expected)
# Then proceed only after confirming
git push --force-with-lease              # Prefer over --force

# Before branch -D (force delete): check for unmerged work
git log --oneline main..<branch>         # Show commits not in main
git branch --no-merged | grep <branch>   # Verify it's truly unmerged
# Then proceed only after confirming
git branch -D <branch>
```

## Advanced Operations

### Interactive Staging and Commits

```bash
git add -p                              # Hunk-by-hunk staging
git add -N <file>                       # Track file without staging content
git commit --fixup=<sha>                # Create fixup for later autosquash
git commit --allow-empty                # Empty commit (CI triggers)
```

### Interactive Rebase

```bash
# Clean commit history before PR
git rebase -i origin/main

# With autosquash (processes fixup!/squash! commits)
git rebase -i --autosquash origin/main

# Enable autosquash globally
git config --global rebase.autoSquash true

# Review merge conflict resolutions during rebase (Git 2.48+)
git range-diff --remerge-diff <base>..<rebased>
```

### Cherry-Pick

```bash
git cherry-pick <sha>                   # Apply single commit
git cherry-pick <sha1>..<sha2>          # Apply range (exclusive of sha1)
git cherry-pick -n <sha>                # Apply without committing (stage only)
git cherry-pick -x <sha>               # Append "cherry picked from" to message
```

### Stash Operations

```bash
git stash push -m "description"         # Named stash
git stash push -- <path>                # Stash specific files
git stash --keep-index                  # Stash unstaged only
git stash pop                           # Apply and remove
git stash apply stash@{2}              # Apply without removing

# Cross-machine stash migration (Git 2.51+)
git stash export > stashes.bundle
git stash import < stashes.bundle
```

### Search and History

```bash
git log -S "search_string"              # Find commits adding/removing string (pickaxe)
git log -G "regex_pattern"              # Find commits matching regex in diffs
git log --follow -p -- <file>           # Full file history including renames
git log --diff-filter=D -- <path>       # Find when files were deleted
git diff main...feature                 # Changes since feature branched from main
git diff --word-diff                    # Word-level diff
```

### Recovery

```bash
# Find lost commits
git reflog show <branch>               # Branch-specific reflog

# Recover after bad rebase/reset — check reflog first
git reflog
git reset --hard HEAD@{2}              # Reset to state 2 moves ago

# Recover deleted branch
git reflog | grep "checkout.*branch-name"
git branch <branch-name> <sha>         # Recreate from found SHA
```

### Merge Conflict Resolution

```bash
# Check mergeability without writing objects (Git 2.50+)
git merge-tree --quiet <base> <branch1> <branch2>

# Enable rerere (reuse recorded resolution)
git config --global rerere.enabled true

# During conflict resolution
git checkout --theirs -- <file>         # Accept incoming
git checkout --ours -- <file>           # Keep current
git checkout --conflict=diff3 -- <file> # Re-show with base version
```

## Commit Conventions

Follow conventional commit format:

```
type(scope): short description

Longer explanation if needed. Wrap at 72 characters.

Refs: #123
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`

## Modern Git Features (2.44-2.52)

Key highlights — full changelog in `references/whats-new.md`:

- **`git last-modified`** (2.52): 5.5x faster file modification tracking
- **`git stash export/import`** (2.51): Cross-machine stash migration
- **`git merge-tree --quiet`** (2.50): Check mergeability without writing objects
- **`git clone --revision`** (2.49): Clone specific commits
- **`git switch`/`git restore`** (2.51): No longer experimental — prefer over `checkout`

## When to Ask for Help

- Choosing between rebase vs merge strategy for the team
- Whether to force push after rebase (check if others use the branch)
- How to handle complex merge conflicts with semantic dependencies
- Repository-specific branching conventions

## References

- [Git Official Documentation](https://git-scm.com/doc)
- [Pro Git Book](https://git-scm.com/book/en/v2)
- [Conventional Commits](https://www.conventionalcommits.org/)

### Skill References

- `references/whats-new.md` - Full Git 2.44-2.52 release notes and new features
- `references/advanced-operations.md` - Interactive rebase, bisect, reflog, cherry-pick, filter-repo, stash, rerere, blame, notes, bundle, sparse-checkout
- `references/branching-workflows.md` - Branching strategies, commit conventions, merge vs rebase, signed commits, tags, release workflows
- `references/config-hooks.md` - Git configuration, conditional includes, aliases, hooks, maintenance, scalar, performance, .gitattributes, .gitignore
