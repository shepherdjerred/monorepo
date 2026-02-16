# Git Configuration, Hooks, and Performance

## Git Configuration

### Configuration Levels

```bash
# System-wide (all users)
git config --system <key> <value>    # /etc/gitconfig

# User-global
git config --global <key> <value>    # ~/.gitconfig or ~/.config/git/config

# Repository-local (default)
git config --local <key> <value>     # .git/config

# Worktree-specific (Git 2.20+)
git config --worktree <key> <value>

# View all config with origins
git config --list --show-origin

# View specific value and its source
git config --show-origin user.email

# New sub-command interface (Git 2.46+)
git config list                      # List all settings
git config get user.email            # Get a specific setting
```

### Essential Configuration

```bash
# Identity
git config --global user.name "Your Name"
git config --global user.email "you@example.com"

# Prevent identity guessing
git config --global user.useConfigOnly true

# Default branch name
git config --global init.defaultBranch main

# Default push behavior
git config --global push.default current
git config --global push.autoSetupRemote true    # Auto set upstream on push

# Pull behavior
git config --global pull.rebase true             # Rebase instead of merge on pull

# Rebase
git config --global rebase.autoSquash true       # Auto-process fixup! commits
git config --global rebase.autoStash true        # Auto-stash before rebase
git config --global rebase.updateRefs true       # Update dependent branches during rebase

# Merge
git config --global merge.conflictStyle zdiff3   # Better conflict markers (shows base)
git config --global rerere.enabled true          # Remember conflict resolutions

# Diff
git config --global diff.algorithm histogram     # Better diff algorithm
git config --global diff.colorMoved default      # Highlight moved lines
git config --global diff.colorMovedWS allow-indentation-change

# Commit signing (SSH)
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
git config --global tag.gpgsign true

# Fetch
git config --global fetch.prune true             # Auto-prune stale tracking branches
git config --global fetch.prunetags true         # Auto-prune stale tags
git config --global fetch.parallel 0             # Parallel fetch (0 = auto-detect)

# Column output
git config --global column.ui auto               # Display branch/tag lists in columns

# Remote HEAD tracking (Git 2.48+)
git config --global remote.origin.followRemoteHead warn
```

### Conditional Includes

Apply different configurations based on directory or remote URL:

```ini
# ~/.gitconfig

[user]
    name = Your Name
    email = personal@example.com

# Work repositories
[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig-work

# Open source repositories
[includeIf "gitdir:~/oss/"]
    path = ~/.gitconfig-oss

# GitHub repositories (Git 2.36+, matches by remote URL)
[includeIf "hasconfig:remote.*.url:https://github.com/**"]
    path = ~/.gitconfig-github

# GitLab repositories
[includeIf "hasconfig:remote.*.url:https://gitlab.com/**"]
    path = ~/.gitconfig-gitlab
```

```ini
# ~/.gitconfig-work
[user]
    email = you@company.com
    signingkey = ~/.ssh/work_ed25519.pub

[commit]
    gpgsign = true
```

**Note**: The trailing slash in `gitdir:~/work/` is required. Order matters -- later includes override earlier ones.

### Useful Aliases

```ini
# ~/.gitconfig
[alias]
    # Short forms
    st = status
    co = checkout
    sw = switch
    br = branch
    ci = commit

    # Log formats
    lg = log --oneline --graph --all --decorate
    ll = log --oneline -20
    hist = log --pretty=format:'%C(auto)%h %ad | %s%d [%an]' --date=short

    # Diff
    ds = diff --staged
    dw = diff --word-diff

    # Branch management
    branches = branch -a -v
    merged = branch --merged
    unmerged = branch --no-merged
    cleanup = "!git branch --merged | grep -v '\\*\\|main\\|master\\|develop' | xargs -n 1 git branch -d"

    # Undo shortcuts
    unstage = restore --staged
    uncommit = reset --soft HEAD~1
    amend = commit --amend --no-edit

    # Fixup workflow
    fixup = "!f() { git commit --fixup=$1; }; f"
    squash-all = "!f() { git rebase -i --autosquash $1; }; f"

    # Working directory
    stash-all = stash push --include-untracked
    wip = "!git add -A && git commit -m 'WIP'"

    # Information
    authors = shortlog -sne
    whoami = "!echo \"$(git config user.name) <$(git config user.email)>\""
    root = rev-parse --show-toplevel

    # Find
    find-merge = "!f() { git log --merges --ancestry-path --oneline $1..HEAD | tail -1; }; f"
    grep-log = "!f() { git log --all -S\"$1\" --oneline; }; f"
```

Shell command aliases (prefixed with `!`) run in the repository root.

## Git Hooks

Hooks are scripts in `.git/hooks/` that execute at specific points in the Git workflow. They are not committed to the repository by default.

### Client-Side Hooks

| Hook | Trigger | Common Use |
|------|---------|------------|
| `pre-commit` | Before commit is created | Lint, format, run fast tests |
| `prepare-commit-msg` | After default message, before editor | Template commit messages |
| `commit-msg` | After user enters message | Validate commit message format |
| `post-commit` | After commit is created | Notifications |
| `pre-rebase` | Before rebase starts | Prevent rebase of published branches |
| `pre-push` | Before push to remote | Run full test suite |
| `pre-merge-commit` | Before merge commit | Validate merge |
| `post-merge` | After merge completes | Install dependencies |
| `post-checkout` | After checkout/switch | Install dependencies, build |
| `post-rewrite` | After rebase/amend | Update dependent data |

### Sharing Hooks with the Team

```bash
# Option 1: core.hooksPath (Git 2.9+)
# Store hooks in the repo
mkdir -p .githooks
# Create hooks in .githooks/
git config core.hooksPath .githooks

# Option 2: Use a hook manager
# pre-commit (Python-based, language-agnostic)
pip install pre-commit
# Create .pre-commit-config.yaml in repo root

# Option 3: Husky (Node.js projects)
npx husky init
```

### Pre-Commit Hook Examples

```bash
#!/bin/sh
# .githooks/pre-commit

# Prevent committing to main/master directly
branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    echo "ERROR: Direct commits to $branch are not allowed."
    echo "Create a feature branch instead."
    exit 1
fi

# Check for debug statements
if git diff --cached --diff-filter=ACM | grep -nE '(console\.log|debugger|binding\.pry|import pdb)'; then
    echo "ERROR: Debug statements found in staged changes."
    exit 1
fi

# Check for secrets patterns
if git diff --cached --diff-filter=ACM | grep -nEi '(password|secret|api_key|token)\s*=\s*["\x27][^"\x27]+'; then
    echo "WARNING: Possible secret detected in staged changes."
    echo "Review carefully before committing."
    exit 1
fi
```

### Commit-msg Hook Example

```bash
#!/bin/sh
# .githooks/commit-msg
# Enforce conventional commit format

commit_msg=$(cat "$1")
pattern='^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?!?: .{1,72}'

if ! echo "$commit_msg" | head -1 | grep -qE "$pattern"; then
    echo "ERROR: Commit message does not follow conventional commit format."
    echo ""
    echo "Expected: <type>(<scope>): <description>"
    echo "Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert"
    echo ""
    echo "Your message: $(head -1 "$1")"
    exit 1
fi
```

### Pre-Push Hook Example

```bash
#!/bin/sh
# .githooks/pre-push
# Prevent force push to protected branches

protected_branches="main master develop"
current_branch=$(git rev-parse --abbrev-ref HEAD)

for branch in $protected_branches; do
    if [ "$current_branch" = "$branch" ]; then
        # Check if this is a force push
        while read local_ref local_sha remote_ref remote_sha; do
            if [ "$remote_sha" != "0000000000000000000000000000000000000000" ]; then
                if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
                    echo "ERROR: Force push to $branch is not allowed."
                    exit 1
                fi
            fi
        done
    fi
done
```

### pre-commit Framework

The [pre-commit](https://pre-commit.com/) framework manages multi-language hook configurations:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
        args: ['--maxkb=500']
      - id: check-merge-conflict
      - id: detect-private-key

  - repo: https://github.com/compilerla/conventional-pre-commit
    rev: v3.4.0
    hooks:
      - id: conventional-pre-commit
        stages: [commit-msg]
```

```bash
# Install hooks from config
pre-commit install
pre-commit install --hook-type commit-msg

# Run against all files (not just staged)
pre-commit run --all-files

# Update hook versions
pre-commit autoupdate
```

## Git Maintenance

### Background Maintenance (Git 2.29+)

```bash
# Register repository for background maintenance
git maintenance register

# Start background maintenance scheduler
git maintenance start

# Stop background maintenance
git maintenance stop

# Unregister repository
git maintenance unregister

# Run maintenance manually
git maintenance run

# Run specific task
git maintenance run --task=gc
git maintenance run --task=commit-graph
git maintenance run --task=prefetch
git maintenance run --task=loose-objects
git maintenance run --task=incremental-repack
git maintenance run --task=pack-refs
```

### Maintenance Tasks (Git 2.50+)

```bash
# Additional tasks available in modern Git
git maintenance run --task=worktree-prune      # Clean stale worktrees
git maintenance run --task=rerere-gc           # Prune old rerere data
git maintenance run --task=reflog-expire       # Expire old reflog entries

# Geometric repacking (Git 2.52+)
# Alternative to all-into-one repacks, avoids full GC
git maintenance run --task=geometric
```

### Maintenance Strategies

```bash
# Use incremental strategy (recommended for most repos)
git config maintenance.strategy incremental

# Incremental strategy schedule:
# Hourly: prefetch, commit-graph
# Daily: loose-objects, incremental-repack
# Weekly: pack-refs
```

## Scalar

Scalar configures Git for large repositories, enabling sparse-checkout, partial clone, and background maintenance automatically.

```bash
# Clone with Scalar (auto-configures for performance)
scalar clone https://github.com/org/large-repo.git

# Clone without sparse checkout
scalar clone --full-clone https://github.com/org/large-repo.git

# Clone without background maintenance
scalar clone --no-maintenance https://github.com/org/large-repo.git

# Register existing repo for Scalar management
scalar register

# Unregister
scalar unregister

# List Scalar-managed repos
scalar list

# Run diagnostics
scalar diagnose
```

Scalar automatically enables:
- Background maintenance (`git maintenance`)
- Filesystem monitor (`core.fsmonitor`)
- Multi-pack index (`core.multiPackIndex`)
- Commit graph (`fetch.writeCommitGraph`, `core.commitGraph`)
- Sparse-checkout (unless `--full-clone`)
- Partial clone with blob filter (unless `--full-clone`)

## Performance Tuning for Large Repos

### Core Settings

```bash
# Filesystem monitor (watches for file changes, avoids scanning)
git config core.fsmonitor true
git config core.untrackedCache true

# Multi-pack index
git config core.multiPackIndex true

# Commit graph
git config fetch.writeCommitGraph true
git config core.commitGraph true

# Pack configuration
git config pack.threads 0            # Auto-detect CPU count
git config pack.windowMemory 0       # Unlimited window memory

# Index settings
git config index.threads 0           # Auto-detect for index operations
git config index.skipHash true       # Skip index hash verification (Git 2.40+)

# Feature flags for performance bundle
git config feature.manyFiles true    # Optimizes for repos with many files
```

### Reftable Backend (Git 2.45+)

For repositories with many references (tags, branches):

```bash
# Migrate existing repo to reftable
git refs migrate --ref-format=reftable

# Clone with reftable format
git clone --ref-format=reftable <url>
```

### Partial Clone

```bash
# Clone without blobs (download on demand)
git clone --filter=blob:none <url>

# Clone without trees (very aggressive, download on demand)
git clone --filter=tree:0 <url>

# Clone with size limit
git clone --filter=blob:limit=1m <url>

# Backfill missing blobs efficiently (Git 2.49+)
git backfill
```

## .gitattributes

Controls per-path settings for merge, diff, and export:

```gitattributes
# Auto-detect text files, ensure LF line endings in repo
* text=auto

# Explicit text files
*.md text
*.txt text
*.csv text
*.json text
*.yml text
*.yaml text

# Explicit binary files
*.png binary
*.jpg binary
*.gif binary
*.ico binary
*.pdf binary
*.zip binary
*.woff2 binary

# Language-specific diff drivers
*.rb diff=ruby
*.py diff=python
*.go diff=golang
*.rs diff=rust

# Lock files - always use theirs on merge
package-lock.json merge=ours -diff
yarn.lock merge=ours -diff
pnpm-lock.yaml merge=ours -diff
Cargo.lock merge=ours -diff

# Export ignore (excluded from git archive)
.gitattributes export-ignore
.gitignore export-ignore
.github/ export-ignore
tests/ export-ignore
docs/ export-ignore

# LFS tracking
*.psd filter=lfs diff=lfs merge=lfs -text
*.sketch filter=lfs diff=lfs merge=lfs -text
```

## .gitignore Patterns

### Pattern Syntax

```gitignore
# Simple file/directory name (matches anywhere)
*.log
node_modules/

# Rooted pattern (only matches from repo root)
/build/
/dist/

# Negate a pattern (re-include something)
*.log
!important.log

# Directory only (trailing slash)
tmp/

# Double star (match across directories)
**/logs           # logs directory anywhere
**/logs/*.log     # .log files in any logs directory
logs/**/*.log     # .log files anywhere under logs/

# Single character wildcard
file?.txt         # file1.txt, fileA.txt

# Character class
file[0-9].txt     # file0.txt through file9.txt
```

### Common .gitignore Entries

```gitignore
# OS files
.DS_Store
Thumbs.db
*.swp
*~

# IDE files
.idea/
.vscode/
*.sublime-workspace

# Environment
.env
.env.local
.env.*.local

# Dependencies
node_modules/
vendor/
__pycache__/
*.pyc
.venv/

# Build outputs
/build/
/dist/
/out/
*.o
*.a
*.so
*.dylib

# Test and coverage
coverage/
.nyc_output/
*.lcov

# Logs
*.log
logs/

# Credentials (always ignore)
*.pem
*.key
*.p12
credentials.json
service-account.json
```

### Debugging .gitignore

```bash
# Check why a file is ignored
git check-ignore -v <file>

# List all ignored files
git ls-files --ignored --exclude-standard

# Force add an ignored file (rarely needed)
git add -f <ignored-file>

# Stop tracking a file that was previously committed
git rm --cached <file>
echo "<file>" >> .gitignore
git commit -m "chore: stop tracking <file>"
```

### Global Gitignore

```bash
# Set up a global gitignore for OS/editor files
git config --global core.excludesFile ~/.gitignore_global
```

```gitignore
# ~/.gitignore_global
.DS_Store
Thumbs.db
*.swp
*~
.idea/
.vscode/
```
