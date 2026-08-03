# Worktree Workflow Scripts

Shell scripts for managing git worktree workflows.

## Starting New Work

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

echo "Worktree created at: $WORKTREE_DIR"
echo "   Branch: $BRANCH_NAME"
echo "   Ready to start coding!"

# Optional: Open in editor
# code .
```

## Creating PR from Worktree

```bash
#!/bin/bash
# pr-from-worktree.sh

set -euo pipefail

# Ensure we're in a worktree (not main)
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  echo "Cannot create PR from main branch"
  exit 1
fi

echo "Creating PR from branch: $CURRENT_BRANCH"

# Push changes
git push -u origin "$CURRENT_BRANCH"

# Create PR
gh pr create --fill

echo "PR created!"
echo "View: gh pr view --web"
```

## Completing Work

```bash
#!/bin/bash
# complete-work.sh

set -euo pipefail

CURRENT_BRANCH=$(git branch --show-current)
WORKTREE_PATH=$(pwd)

echo "Completing work on: $CURRENT_BRANCH"

# Ensure everything is committed
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "You have uncommitted changes"
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

## Quick Switch Script

```bash
#!/bin/bash
# switch-worktree.sh <worktree-name>

WORKTREE_NAME=${1:?Usage: switch-worktree.sh <worktree-name>}
WORKTREE_BASE="$HOME/worktrees/$(basename $(git rev-parse --show-toplevel))"
WORKTREE_PATH="$WORKTREE_BASE/$WORKTREE_NAME"

if [ -d "$WORKTREE_PATH" ]; then
  cd "$WORKTREE_PATH"
  echo "Switched to: $WORKTREE_PATH"
else
  echo "Worktree not found: $WORKTREE_PATH"
  echo ""
  echo "Available worktrees:"
  git worktree list
  exit 1
fi
```

## List Worktrees with Branch Status

```bash
#!/bin/bash
# worktree-status.sh

git worktree list | while IFS= read -r line; do
  # Extract worktree path
  path=$(echo "$line" | awk '{print $1}')
  branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

  echo "=========================================="
  echo "Path: $path"
  echo "Branch: $branch"

  # Show git status in that worktree
  if [ -d "$path" ]; then
    (
      cd "$path" 2>/dev/null && {
        if git diff --quiet && git diff --cached --quiet; then
          echo "Clean"
        else
          echo "Uncommitted changes"
        fi

        # Show if branch has upstream
        if git rev-parse --abbrev-ref @{u} &>/dev/null; then
          ahead=$(git rev-list --count @{u}..HEAD)
          behind=$(git rev-list --count HEAD..@{u})
          [ $ahead -gt 0 ] && echo "$ahead commit(s) ahead"
          [ $behind -gt 0 ] && echo "$behind commit(s) behind"
        else
          echo "No upstream branch"
        fi
      }
    )
  fi
  echo ""
done
```

## Cleanup Merged Worktrees

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
      echo "Removing merged worktree: $current_worktree ($branch)"
      git worktree remove "$current_worktree" || true
      git branch -d "$branch" || true
    fi
  fi
done

# Prune stale references
git worktree prune

echo "Cleanup complete"
```

## Find Orphaned Worktrees

```bash
#!/bin/bash
# find-orphaned-worktrees.sh
# Finds worktrees where the branch has been deleted remotely

set -euo pipefail

echo "Searching for orphaned worktrees..."

git fetch --prune  # Update remote tracking branches

ORPHANED=0

git worktree list --porcelain | grep -E "^worktree|^branch" | while read -r line; do
  if [[ $line =~ ^worktree ]]; then
    current_worktree=$(echo "$line" | awk '{print $2}')
  elif [[ $line =~ ^branch ]]; then
    branch=$(echo "$line" | awk '{print $2}' | sed 's|refs/heads/||')

    # Skip main/master branches
    [[ "$branch" =~ ^(main|master)$ ]] && continue

    # Check if remote branch exists
    if ! git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      echo "Orphaned worktree found:"
      echo "   Path: $current_worktree"
      echo "   Branch: $branch (remote deleted)"
      echo "   Cleanup: git worktree remove $current_worktree && git branch -d $branch"
      echo ""
      ORPHANED=$((ORPHANED + 1))
    fi
  fi
done

# Prune stale worktree admin files
git worktree prune

if [ $ORPHANED -eq 0 ]; then
  echo "No orphaned worktrees found"
else
  echo "Found $ORPHANED orphaned worktree(s)"
fi
```

## Combined Start-to-PR Script

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

    echo "Ready to code!"
    echo "   Path: $WORKTREE_DIR"
    echo "   Branch: $BRANCH_NAME"
    ;;

  pr)
    # Must be in worktree
    CURRENT_BRANCH=$(git branch --show-current)
    if [ "$CURRENT_BRANCH" = "main" ]; then
      echo "Must be in feature worktree"
      exit 1
    fi

    # Push and create PR
    git push -u origin "$CURRENT_BRANCH"
    gh pr create --fill

    echo "PR created!"
    gh pr view
    ;;

  done)
    CURRENT_BRANCH=$(git branch --show-current)
    WORKTREE_PATH=$(pwd)

    # Ensure clean
    if ! git diff --quiet || ! git diff --cached --quiet; then
      echo "Uncommitted changes"
      exit 1
    fi

    # Check if PR is merged
    if gh pr view --json state --jq .state | grep -q "MERGED"; then
      echo "PR merged!"

      # Return to main worktree
      MAIN_WORKTREE=$(git worktree list | grep "(main)" | awk '{print $1}')
      cd "$MAIN_WORKTREE"

      # Update main
      git pull origin main

      # Remove worktree and branch
      git worktree remove "$WORKTREE_PATH"
      git branch -d "$CURRENT_BRANCH"

      echo "Cleaned up worktree and branch"
    else
      echo "PR not merged yet"
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
