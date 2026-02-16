# Advanced Git Operations

## Interactive Rebase

Interactive rebase (`git rebase -i`) rewrites commit history by allowing you to reorder, edit, squash, fixup, or drop commits.

### Basic Usage

```bash
# Rebase last N commits
git rebase -i HEAD~5

# Rebase onto a branch
git rebase -i origin/main

# Rebase with autosquash (auto-processes fixup!/squash! commits)
git rebase -i --autosquash origin/main
```

### Rebase Commands

In the interactive editor, each commit is prefixed with a command:

| Command    | Short | Effect |
|-----------|-------|--------|
| `pick`    | `p`   | Use commit as-is |
| `reword`  | `r`   | Use commit but edit message |
| `edit`    | `e`   | Pause at commit for amending |
| `squash`  | `s`   | Meld into previous commit, combine messages |
| `fixup`   | `f`   | Meld into previous commit, discard this message |
| `drop`    | `d`   | Remove commit entirely |
| `exec`    | `x`   | Run shell command after commit |
| `break`   | `b`   | Stop here (continue with `--continue`) |

### Fixup and Autosquash Workflow

The fixup/autosquash pattern lets you create correction commits that automatically fold into their targets:

```bash
# Make original commit
git commit -m "feat: add user validation"

# Later, fix something in that commit
git add fixed-file.ts
git commit --fixup=<sha-of-original>    # Creates "fixup! feat: add user validation"

# Or create an amend fixup (also updates commit message)
git commit --fixup=amend:<sha>

# When ready, autosquash folds fixups into their targets
git rebase -i --autosquash origin/main

# Enable autosquash globally so you never forget
git config --global rebase.autoSquash true
```

### Rebase with Merge Commits

```bash
# Preserve merge commits during rebase
git rebase -i --rebase-merges origin/main

# Review merge conflict resolutions with range-diff (Git 2.48+)
git range-diff --remerge-diff main..feature
```

### Safety During Rebase

```bash
# Before rebase, save a reference
git branch backup-branch

# If rebase goes wrong, abort
git rebase --abort

# After rebase, compare results
git diff backup-branch..HEAD    # Should be empty if only history changed
git log --oneline backup-branch..HEAD   # New commits
git log --oneline HEAD..backup-branch   # Old commits (should be replaced)
```

## Git Bisect

Binary search through commit history to find which commit introduced a bug.

### Manual Bisect

```bash
# Start bisecting
git bisect start

# Mark current state as bad
git bisect bad

# Mark a known good commit
git bisect good v1.0.0    # or a specific SHA

# Git checks out a middle commit - test it, then:
git bisect good           # If this commit works
git bisect bad            # If this commit has the bug

# Repeat until Git identifies the first bad commit
# When done:
git bisect reset          # Return to original state
```

### Automated Bisect

```bash
# Automate with a test script (exit 0 = good, exit 1 = bad)
git bisect start HEAD v1.0.0
git bisect run npm test

# Use any command - exits 0 for good, non-zero for bad
git bisect run make test
git bisect run ./check-bug.sh

# Skip untestable commits (e.g., broken build)
git bisect skip

# Exit code 125 means "skip this commit" in automated bisect
git bisect run sh -c 'make || exit 125; ./test.sh'
```

### Bisect with Specific Paths

```bash
# Only consider commits that touched specific paths
git bisect start -- src/auth/
```

### Recovery and Logging

```bash
# View bisect log
git bisect log

# Replay a bisect session
git bisect log > bisect-log.txt
git bisect replay bisect-log.txt

# If you marked a commit incorrectly
git bisect log > bisect-log.txt
# Edit the file to remove incorrect entries
git bisect reset
git bisect replay bisect-log.txt
```

## Reflog

The reflog records every change to HEAD and branch tips locally. It is your safety net for recovering from mistakes.

### Viewing Reflog

```bash
# Show HEAD reflog (default)
git reflog

# Show reflog for a specific branch
git reflog show feature/auth

# Show reflog with timestamps
git reflog --date=iso

# Show reflog for stash
git reflog show stash

# List all refs with reflogs
git reflog list
```

### Recovery Patterns

```bash
# Recover from bad rebase
git reflog
# Find entry before the rebase, e.g., HEAD@{5}
git reset --hard HEAD@{5}

# Recover deleted branch
git reflog | grep "checkout.*deleted-branch"
# Find the SHA, then:
git branch recovered-branch <sha>

# Recover lost commit after reset
git reflog
git cherry-pick <sha-from-reflog>

# Recover dropped stash
git fsck --unreachable | grep commit
git show <sha>           # Inspect to find your stash
git stash apply <sha>    # Apply the lost stash
```

### Reflog Expiration

```bash
# Reflog entries expire (default: 90 days unreachable, 30 days reachable)
# Customize expiration
git config gc.reflogExpire "180 days"
git config gc.reflogExpireUnreachable "90 days"

# Manually expire reflog entries
git reflog expire --expire=90.days.ago --all
```

## Cherry-Pick

Apply specific commits from one branch to another.

### Basic Usage

```bash
# Cherry-pick a single commit
git cherry-pick <sha>

# Cherry-pick without committing (stage changes only)
git cherry-pick --no-commit <sha>
# or
git cherry-pick -n <sha>

# Cherry-pick and edit the commit message
git cherry-pick --edit <sha>
```

### Multiple and Range Cherry-Picks

```bash
# Cherry-pick multiple non-consecutive commits
git cherry-pick <sha1> <sha2> <sha3>

# Cherry-pick a range (exclusive start, inclusive end)
git cherry-pick A..B      # Does NOT include A

# Cherry-pick a range (inclusive of both endpoints)
git cherry-pick A^..B     # Includes A through B

# Cherry-pick and mark the source commit
git cherry-pick -x <sha>  # Appends "(cherry picked from commit ...)" to message
```

### Handling Conflicts

```bash
# If conflicts occur during cherry-pick
git status                     # See conflicted files
# ... resolve conflicts ...
git add <resolved-files>
git cherry-pick --continue

# Abort cherry-pick
git cherry-pick --abort

# Skip current commit and continue with remaining
git cherry-pick --skip
```

### Best Practices

- Prefer merge or rebase over cherry-pick when possible to maintain cleaner history
- Use `-x` flag to record the source commit SHA for traceability
- Cherry-pick small, self-contained commits; avoid large refactors
- Create a dedicated branch before cherry-picking a range of commits

## git filter-repo

`git filter-repo` is the recommended tool for rewriting repository history (replacing the deprecated `git filter-branch`). It must be installed separately.

### Installation

```bash
# macOS
brew install git-filter-repo

# pip
pip install git-filter-repo
```

### Common Operations

```bash
# Remove a file from all history
git filter-repo --path secrets.env --invert-paths

# Remove a directory from all history
git filter-repo --path src/deprecated/ --invert-paths

# Keep only a subdirectory (extract into its own repo)
git filter-repo --subdirectory-filter src/lib/

# Rename/move paths throughout history
git filter-repo --path-rename old/path/:new/path/

# Remove large files from history
git filter-repo --strip-blobs-bigger-than 10M

# Replace text in all files throughout history
git filter-repo --replace-text expressions.txt
# expressions.txt format: literal:old_text==>new_text

# Mailmap-style author rewriting
git filter-repo --mailmap mailmap.txt
```

### Safety Notes

- Always work on a fresh clone: `git clone --mirror <url> && cd <repo>`
- filter-repo intentionally removes the remote to prevent accidental pushes
- After filtering, force-push: `git remote add origin <url> && git push --force --all`
- All collaborators must re-clone after history rewriting

## Subtree vs Submodule

### Git Subtree

Subtree merges external repository content directly into your repository.

```bash
# Add a subtree
git subtree add --prefix=lib/external https://github.com/org/lib.git main --squash

# Pull updates from the external repo
git subtree pull --prefix=lib/external https://github.com/org/lib.git main --squash

# Push changes back to the external repo
git subtree push --prefix=lib/external https://github.com/org/lib.git main

# Split subtree into its own branch (for extraction)
git subtree split --prefix=lib/external -b extracted-lib
```

**When to use subtree**: Vendoring third-party code, shared internal libraries, simpler onboarding (no extra commands for collaborators).

### Git Submodule

Submodule maintains a pointer to a specific commit in another repository.

```bash
# Add a submodule
git submodule add https://github.com/org/lib.git lib/external

# Clone a repo with submodules
git clone --recurse-submodules <url>

# Initialize and update submodules after clone
git submodule update --init --recursive

# Update all submodules to latest
git submodule update --remote

# Remove a submodule
git submodule deinit lib/external
git rm lib/external
rm -rf .git/modules/lib/external
```

**When to use submodule**: Strict version pinning, large external dependencies, separate build/CI for the dependency.

## Stash Operations

### Basic Stash

```bash
# Stash working directory changes
git stash                       # or git stash push
git stash push -m "description" # With a message

# Include untracked files
git stash push -u               # or --include-untracked

# Stash only staged changes (Git 2.35+)
git stash push --staged

# Stash specific files
git stash push -- path/to/file1 path/to/file2

# Interactive stash (select hunks)
git stash push -p
```

### Managing Stashes

```bash
# List stashes
git stash list

# Apply most recent stash (keep in stash list)
git stash apply

# Apply and remove from stash list
git stash pop

# Apply a specific stash
git stash apply stash@{2}

# Show stash contents
git stash show                  # Summary
git stash show -p               # Full diff
git stash show -p stash@{1}    # Specific stash

# Create branch from stash
git stash branch <new-branch> stash@{0}

# Drop a specific stash
git stash drop stash@{0}

# Clear all stashes
git stash clear
```

### Stash Export/Import (Git 2.51+)

```bash
# Export stashes to a reference (for sharing across machines)
git stash export

# Import stashes from a reference
git stash import

# Push exported stashes to remote
git push origin refs/stashes/<user>

# Fetch and import from remote
git fetch origin refs/stashes/<user>
git stash import
```

## Rerere (Reuse Recorded Resolution)

Rerere records how you resolve merge conflicts and automatically applies the same resolution if the same conflict recurs.

### Setup

```bash
# Enable rerere globally
git config --global rerere.enabled true
```

### Usage

```bash
# After resolving a conflict, rerere automatically records it
# Next time the same conflict occurs, Git auto-resolves it

# View current rerere state
git rerere status

# Show diff of what rerere would resolve
git rerere diff

# Forget a recorded resolution
git rerere forget <pathspec>

# Clear all recorded resolutions
git rerere clear
```

### When Rerere Helps

- Repeatedly rebasing a long-lived branch onto main
- Undoing a merge to redo it differently (same conflicts, same resolutions)
- Testing merge results before actually merging (merge, test, reset, then merge later)
- Maintaining topic branches that are frequently re-integrated

### Expiration

```bash
# Default: unresolved 15 days, resolved 60 days
# Customize
git config gc.rerereResolved "90 days"
git config gc.rerereUnresolved "30 days"

# Git 2.50+ maintenance task
git maintenance run --task=rerere-gc
```

## Git Blame

### Basic Usage

```bash
# Blame a file
git blame <file>

# Blame specific lines
git blame -L 10,20 <file>       # Lines 10-20
git blame -L '/^function/',+10 <file>  # Regex start, 10 lines

# Show email instead of name
git blame -e <file>

# Show original commit for moved/copied lines
git blame -C <file>              # Detect copies within same commit
git blame -C -C <file>           # Detect copies from other files in same commit
git blame -C -C -C <file>        # Detect copies from any commit
git blame -M <file>              # Detect moved lines within a file
```

### Ignore Revisions

Skip bulk formatting or refactoring commits in blame output:

```bash
# Ignore a specific revision
git blame --ignore-rev <sha> <file>

# Use an ignore file
git blame --ignore-revs-file .git-blame-ignore-revs <file>

# Configure globally for the repo
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

The `.git-blame-ignore-revs` file format:

```
# Prettier formatting migration
abc123def456789...

# ESLint autofix bulk commit
def789abc123456...
```

GitHub automatically recognizes `.git-blame-ignore-revs` files.

## Git Notes

Attach metadata to commits without modifying commit history.

```bash
# Add a note to a commit
git notes add -m "This commit fixes CVE-2024-1234" <sha>

# Add a note to HEAD
git notes add -m "Reviewed by: security team"

# Show notes
git log --show-notes

# Edit an existing note
git notes edit <sha>

# Remove a note
git notes remove <sha>

# Push notes to remote
git push origin refs/notes/commits

# Fetch notes from remote
git fetch origin refs/notes/*:refs/notes/*

# Notes in different namespaces
git notes --ref=review add -m "LGTM" <sha>
git log --show-notes=review
```

## Git Bundle

Create portable, offline-transferable repository archives.

### Creating Bundles

```bash
# Full repository bundle
git bundle create repo.bundle --all

# Bundle specific branch
git bundle create feature.bundle main..feature/auth

# Incremental bundle (since last bundle)
git bundle create incremental.bundle --since="2025-01-01" --all

# Bundle with tags
git bundle create release.bundle v1.0..v2.0
```

### Using Bundles

```bash
# Verify a bundle
git bundle verify repo.bundle

# Clone from a bundle
git clone repo.bundle my-repo

# Fetch from a bundle into existing repo
git fetch repo.bundle main:refs/remotes/bundle/main

# List references in a bundle
git bundle list-heads repo.bundle
```

### Bundle URI (Git 2.50+)

Bundle URIs allow Git hosting services to provide pre-computed bundles, speeding up initial clones:

```bash
# Clone using bundle URI
git clone --bundle-uri=https://example.com/repo.bundle https://example.com/repo.git
```

## Sparse Checkout

Work with only a subset of files in a large repository.

### Setup

```bash
# Enable sparse checkout
git sparse-checkout init

# Use cone mode (recommended, faster)
git sparse-checkout init --cone

# Set directories to include
git sparse-checkout set src/frontend src/shared docs/

# Add directories
git sparse-checkout add tests/frontend

# List current sparse checkout patterns
git sparse-checkout list

# Disable sparse checkout (restore full working tree)
git sparse-checkout disable
```

### With Partial Clone

```bash
# Clone large repo with sparse checkout and partial clone
git clone --filter=blob:none --sparse https://github.com/org/monorepo.git
cd monorepo
git sparse-checkout set src/my-service

# Backfill historical blobs efficiently (Git 2.49+)
git backfill
```

### Clean Recovery (Git 2.52+)

```bash
# Recover from files left outside sparse-checkout definition
git sparse-checkout clean
```
