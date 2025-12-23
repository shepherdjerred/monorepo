---
description: Git worktree workflow for isolated feature development and PR creation
when_to_use: When user starts new work, needs to switch contexts, or wants parallel development
---

# Git Worktree Workflow Agent

## Overview

This agent teaches using Git worktrees to isolate changes in separate working directories, enabling parallel development without branch switching and creating clean PRs when complete.

## Core Concept

Git worktrees let you have multiple working directories from the same repository:
- **Main worktree**: Your primary working directory (usually `main` or `master`)
- **Linked worktrees**: Additional directories for features/fixes, each on different branches
- **No branch switching**: Each worktree has its own branch checked out
- **Shared .git**: All worktrees share the same repository data

## CLI Commands

### Creating Worktrees

```bash
# Create worktree for new feature
git worktree add ../feature-auth feature/auth

# Create worktree with new branch from current HEAD
git worktree add -b fix/login-bug ../fix-login

# Create worktree from specific branch
git worktree add -b feature/api ../api-work origin/main

# Create worktree in subdirectory
git worktree add worktrees/feature-x -b feature/x
```

### Listing Worktrees

```bash
# List all worktrees
git worktree list

# List with more details
git worktree list --porcelain
```

### Removing Worktrees

```bash
# Remove worktree (deletes directory and unregisters)
git worktree remove ../feature-auth

# Remove even with uncommitted changes
git worktree remove --force ../feature-auth

# Clean up stale worktree references
git worktree prune
```

### Moving Between Worktrees

```bash
# Navigate to worktree
cd ../feature-auth

# Or use absolute path
cd ~/git/myproject-feature-auth

# Return to main worktree
cd ~/git/myproject
```

## Complete Workflow

### Starting New Work

```bash
#!/bin/bash
# start-work.sh <feature-name>

set -euo pipefail

FEATURE_NAME=${1:?Usage: start-work.sh <feature-name>}
BRANCH_NAME="feature/${FEATURE_NAME}"
WORKTREE_DIR="../${FEATURE_NAME}"

echo "Starting new work: $FEATURE_NAME"

# Create worktree from main
git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" origin/main

# Navigate to worktree
cd "$WORKTREE_DIR"

echo "✅ Worktree created at: $WORKTREE_DIR"
echo "   Branch: $BRANCH_NAME"
echo "   Ready to start coding!"

# Optional: Open in editor
# code .
```

### Working in Worktree

```bash
# In your worktree directory
cd ../feature-auth

# Make changes
echo "new feature" > feature.ts

# Stage and commit as usual
git add feature.ts
git commit -m "feat: add authentication"

# Push to remote
git push -u origin feature/auth
```

### Creating PR from Worktree

```bash
#!/bin/bash
# pr-from-worktree.sh

set -euo pipefail

# Ensure we're in a worktree (not main)
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  echo "❌ Cannot create PR from main branch"
  exit 1
fi

echo "Creating PR from branch: $CURRENT_BRANCH"

# Push changes
git push -u origin "$CURRENT_BRANCH"

# Create PR
gh pr create --fill

echo "✅ PR created!"
echo "View: gh pr view --web"
```

### Completing Work

```bash
#!/bin/bash
# complete-work.sh

set -euo pipefail

CURRENT_BRANCH=$(git branch --show-current)
WORKTREE_PATH=$(pwd)

echo "Completing work on: $CURRENT_BRANCH"

# Ensure everything is committed
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ You have uncommitted changes"
  git status
  exit 1
fi

# Push final changes
git push

# Create PR if it doesn't exist
if ! gh pr view &>/dev/null; then
  echo "Creating PR..."
  gh pr create --fill
fi

# Show PR status
gh pr view

# Return to main worktree
cd "$(git rev-parse --show-toplevel)"

echo ""
echo "Next steps:"
echo "  1. Review PR: gh pr view --web"
echo "  2. After merge: git worktree remove $WORKTREE_PATH"
echo "  3. Clean up: git branch -d $CURRENT_BRANCH"
```

## Advanced Patterns

### Organized Worktree Layout

```bash
# Create worktrees in dedicated directory
WORKTREE_BASE="$HOME/worktrees/$(basename $(git rev-parse --show-toplevel))"
mkdir -p "$WORKTREE_BASE"

# Create worktree
git worktree add "$WORKTREE_BASE/feature-auth" -b feature/auth

# Your layout:
# ~/git/myproject/              (main worktree)
# ~/worktrees/myproject/
#   ├── feature-auth/            (feature worktree)
#   ├── fix-bug-123/             (bugfix worktree)
#   └── refactor-api/            (refactor worktree)
```

### Quick Switch Script

```bash
#!/bin/bash
# switch-worktree.sh <worktree-name>

WORKTREE_NAME=${1:?Usage: switch-worktree.sh <worktree-name>}
WORKTREE_BASE="$HOME/worktrees/$(basename $(git rev-parse --show-toplevel))"
WORKTREE_PATH="$WORKTREE_BASE/$WORKTREE_NAME"

if [ -d "$WORKTREE_PATH" ]; then
  cd "$WORKTREE_PATH"
  echo "✅ Switched to: $WORKTREE_PATH"
else
  echo "❌ Worktree not found: $WORKTREE_PATH"
  echo ""
  echo "Available worktrees:"
  git worktree list
  exit 1
fi
```

### List Worktrees with Branch Status

```bash
#!/bin/bash
# worktree-status.sh

git worktree list | while IFS= read -r line; do
  # Extract worktree path
  path=$(echo "$line" | awk '{print $1}')
  branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📁 $path"
  echo "🌿 $branch"

  # Show git status in that worktree
  if [ -d "$path" ]; then
    (
      cd "$path" 2>/dev/null && {
        if git diff --quiet && git diff --cached --quiet; then
          echo "✅ Clean"
        else
          echo "⚠️  Uncommitted changes"
        fi

        # Show if branch has upstream
        if git rev-parse --abbrev-ref @{u} &>/dev/null; then
          ahead=$(git rev-list --count @{u}..HEAD)
          behind=$(git rev-list --count HEAD..@{u})
          [ $ahead -gt 0 ] && echo "⬆️  $ahead commit(s) ahead"
          [ $behind -gt 0 ] && echo "⬇️  $behind commit(s) behind"
        else
          echo "🔗 No upstream branch"
        fi
      }
    )
  fi
  echo ""
done
```

### Cleanup Merged Worktrees

```bash
#!/bin/bash
# cleanup-merged-worktrees.sh

set -euo pipefail

# Get default branch
DEFAULT_BRANCH=$(git remote show origin | grep "HEAD branch" | sed 's/.*: //')

echo "Cleaning up merged worktrees (base: $DEFAULT_BRANCH)..."

# Update refs
git fetch origin --prune

# Find merged branches
git worktree list --porcelain | grep -E "^worktree|^branch" | while read -r line; do
  if [[ $line =~ ^worktree ]]; then
    current_worktree=$(echo "$line" | awk '{print $2}')
  elif [[ $line =~ ^branch ]]; then
    branch=$(echo "$line" | awk '{print $2}' | sed 's|refs/heads/||')

    # Skip default branch
    [ "$branch" = "$DEFAULT_BRANCH" ] && continue

    # Check if merged
    if git branch --merged "origin/$DEFAULT_BRANCH" | grep -q "^[* ]*$branch$"; then
      echo "🗑️  Removing merged worktree: $current_worktree ($branch)"
      git worktree remove "$current_worktree" || true
      git branch -d "$branch" || true
    fi
  fi
done

# Prune stale references
git worktree prune

echo "✅ Cleanup complete"
```

## Integration with PR Workflow

### Combined Start-to-PR Script

```bash
#!/bin/bash
# feature.sh <command> [name]
# Commands: start, pr, done

set -euo pipefail

COMMAND=${1:?Usage: feature.sh <start|pr|done> [name]}
WORKTREE_BASE="$HOME/worktrees/$(basename $(git rev-parse --show-toplevel))"

case $COMMAND in
  start)
    FEATURE_NAME=${2:?Usage: feature.sh start <feature-name>}
    BRANCH_NAME="feature/${FEATURE_NAME}"
    WORKTREE_DIR="$WORKTREE_BASE/$FEATURE_NAME"

    echo "Starting feature: $FEATURE_NAME"

    # Ensure we're up to date
    git fetch origin

    # Create worktree
    git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" origin/main

    # Navigate
    cd "$WORKTREE_DIR"

    echo "✅ Ready to code!"
    echo "   Path: $WORKTREE_DIR"
    echo "   Branch: $BRANCH_NAME"
    ;;

  pr)
    # Must be in worktree
    CURRENT_BRANCH=$(git branch --show-current)
    if [ "$CURRENT_BRANCH" = "main" ]; then
      echo "❌ Must be in feature worktree"
      exit 1
    fi

    # Push and create PR
    git push -u origin "$CURRENT_BRANCH"
    gh pr create --fill

    echo "✅ PR created!"
    gh pr view
    ;;

  done)
    CURRENT_BRANCH=$(git branch --show-current)
    WORKTREE_PATH=$(pwd)

    # Ensure clean
    if ! git diff --quiet || ! git diff --cached --quiet; then
      echo "❌ Uncommitted changes"
      exit 1
    fi

    # Check if PR is merged
    if gh pr view --json state --jq .state | grep -q "MERGED"; then
      echo "✅ PR merged!"

      # Return to main worktree
      MAIN_WORKTREE=$(git worktree list | grep "(main)" | awk '{print $1}')
      cd "$MAIN_WORKTREE"

      # Update main
      git pull origin main

      # Remove worktree and branch
      git worktree remove "$WORKTREE_PATH"
      git branch -d "$CURRENT_BRANCH"

      echo "✅ Cleaned up worktree and branch"
    else
      echo "⚠️  PR not merged yet"
      gh pr view
    fi
    ;;

  *)
    echo "Unknown command: $COMMAND"
    echo "Usage: feature.sh <start|pr|done> [name]"
    exit 1
    ;;
esac
```

## Best Practices

### 1. Worktree Naming Convention

```bash
# Use consistent naming
git worktree add ../feature-auth -b feature/auth         # ✅ Good
git worktree add ../auth -b feature/authentication       # ❌ Inconsistent

# Match directory name to branch suffix
feature/auth     → ../feature-auth
fix/login-bug    → ../fix-login-bug
refactor/api     → ../refactor-api
```

### 2. Keep Worktrees Outside Main Repo

```bash
# ✅ Good - outside main repo
~/git/myproject/                    (main)
~/git/myproject-feature-auth/       (worktree)
~/git/myproject-fix-bug/            (worktree)

# ❌ Bad - inside main repo (causes confusion)
~/git/myproject/                    (main)
~/git/myproject/feature-auth/       (worktree - AVOID)
```

### 3. Regular Cleanup

```bash
# Weekly cleanup of merged worktrees
git fetch --prune
git worktree prune
git branch --merged | grep -v "main\|master" | xargs git branch -d
```

### 4. Don't Share Branches Between Worktrees

```bash
# ❌ Bad - same branch in multiple worktrees
git worktree add ../feature-1 -b feature/auth
git worktree add ../feature-2 feature/auth  # ERROR!

# ✅ Good - unique branch per worktree
git worktree add ../feature-1 -b feature/auth
git worktree add ../feature-2 -b feature/auth-v2
```

### 5. Backup Before Removing

```bash
# Check for uncommitted changes before removing
if ! (cd ../feature-auth && git diff --quiet); then
  echo "⚠️  Uncommitted changes in worktree!"
  exit 1
fi

git worktree remove ../feature-auth
```

## Common Workflows

### Workflow 1: Quick Bug Fix

```bash
# Start fix
git worktree add ../fix-critical -b fix/critical-bug origin/main
cd ../fix-critical

# Make fix
echo "fix" > bug-fix.ts
git add bug-fix.ts
git commit -m "fix: critical bug"

# Create PR
git push -u origin fix/critical-bug
gh pr create --title "fix: critical bug" --body "Fixes #123"

# After merge
cd ~/git/myproject
git worktree remove ../fix-critical
git branch -d fix/critical-bug
```

### Workflow 2: Long-Running Feature

```bash
# Start feature
git worktree add ../feature-big -b feature/big-feature origin/main
cd ../feature-big

# Work over several days
git commit -m "feat: part 1"
git push -u origin feature/big-feature

# Sync with main periodically
git fetch origin
git rebase origin/main

# Create PR when ready
gh pr create --fill
```

### Workflow 3: Parallel Features

```bash
# Work on multiple features simultaneously
git worktree add ../feature-api -b feature/api
git worktree add ../feature-ui -b feature/ui
git worktree add ../feature-docs -b feature/docs

# Switch between them without branch checkout
cd ../feature-api    # Work on API
cd ../feature-ui     # Switch to UI
cd ../feature-docs   # Switch to docs
```

## Troubleshooting

### Issue: "Cannot remove worktree with uncommitted changes"

```bash
# Option 1: Commit or stash changes
cd ../feature-auth
git add -A && git commit -m "WIP"
# or
git stash

# Option 2: Force remove (loses changes!)
git worktree remove --force ../feature-auth
```

### Issue: "Branch already checked out"

```bash
# You can't check out the same branch in multiple worktrees
# Solution: Create a new branch
git worktree add ../feature-auth-v2 -b feature/auth-v2 feature/auth
```

### Issue: Worktree directory deleted manually

```bash
# Clean up stale references
git worktree prune

# Verify
git worktree list
```

## When to Ask for Help

Ask the user for clarification when:
- Worktree layout preferences (flat vs nested, naming conventions)
- How to handle merge conflicts during rebase
- Whether to keep or remove worktree after PR merge
- Multiple people working on same repository with worktrees
- Integration with IDEs or editors for worktree navigation
