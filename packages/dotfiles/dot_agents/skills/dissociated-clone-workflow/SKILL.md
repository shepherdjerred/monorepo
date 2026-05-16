---
name: dissociated-clone-workflow
description: |
  Fully isolated clones via `git clone --shared --dissociate` for parallel feature development without shared stash/reflog
  When user starts new work, needs isolated checkouts, wants parallel development, asks for worktree alternatives, or hits stash/reflog collisions across worktrees
---

# Dissociated-Clone Workflow Agent

## Why Not Worktrees?

`git worktree` shares one `.git` across all checkouts, which means:

- **Shared stash** (`refs/stash`) — `git stash` pushes from any worktree land on the same stack. Stashing is sometimes unavoidable (e.g., merges that require a clean tree), so collisions are real.
- **Shared reflog** — debugging "what happened to my HEAD?" gets noisy across parallel work.
- **Shared `gc` / packfiles** — one worktree's gc can affect others.

For parallel feature work or multi-agent runs, a fully independent clone is safer. This skill uses `git clone --shared --dissociate` to get one fast, then detach.

## Overview

`--shared` makes the clone use the source's object store via an `objects/info/alternates` link (no copying, no network). `--dissociate` then copies the needed objects into the new clone and removes the alternates link. End state: a normal independent clone — own `.git`, own stash, own reflog, safe to gc, source repo can be deleted without breaking it.

Verified: stash, reflog, and `gc` are isolated; `.git/objects/info/alternates` is absent after dissociate.

## Core Concept

```
Step 1 (--shared):
  new-clone/.git/objects/info/alternates → /path/to/source/.git/objects
  (zero object copying, instant clone setup)

Step 2 (--dissociate, applied as part of the same command):
  copies needed objects into new-clone/.git/objects/
  removes the alternates file
  result: fully independent clone, no link to source
```

Both steps happen in one `git clone` invocation when both flags are passed.

## CLI Commands

### Creating a Clone

```bash
# Canonical pattern: bootstrap from local, then re-point origin
git clone --shared --dissociate \
  /path/to/source-repo \
  ~/git/<repo>-<feature-slug>

cd ~/git/<repo>-<feature-slug>

# Re-point origin from the local source path to the real remote.
# Without this, `git push` would push to the local source, not GitHub.
git remote set-url origin <remote-url>

# Fetch and prune so remote-tracking refs reflect the real remote
# (the clone inherits local-only branches from the source as remotes/origin/* — prune removes them).
git fetch origin --prune

# Branch off the real origin/main
git switch -c feature/<slug> origin/main
```

### Listing Clones

```bash
# Sibling layout means clones are just directories
ls -d ~/git/<repo>-*/

# With branch info per clone
for d in ~/git/<repo>-*/; do
  printf "%s\t%s\n" "$d" "$(git -C "$d" branch --show-current)"
done
```

### Removing a Clone

```bash
# After PR merge, just delete — no `git worktree remove` needed
rm -rf ~/git/<repo>-<feature-slug>

# Clean up the local branch in the main checkout
git -C /path/to/source-repo branch -d feature/<slug>
```

## Complete Workflow

### Starting New Work

```bash
#!/bin/bash
# start-work.sh <feature-name>

set -euo pipefail

FEATURE_NAME=${1:?Usage: start-work.sh <feature-name>}
SOURCE_REPO=${SOURCE_REPO:-$(git rev-parse --show-toplevel)}
REMOTE_URL=$(git -C "$SOURCE_REPO" remote get-url origin)
REPO_BASENAME=$(basename "$SOURCE_REPO")
CLONE_DIR="$(dirname "$SOURCE_REPO")/${REPO_BASENAME}-${FEATURE_NAME}"
BRANCH_NAME="feature/${FEATURE_NAME}"

echo "Cloning $SOURCE_REPO → $CLONE_DIR (dissociated)"

git clone --shared --dissociate "$SOURCE_REPO" "$CLONE_DIR"
cd "$CLONE_DIR"

git remote set-url origin "$REMOTE_URL"
git fetch origin --prune

git switch -c "$BRANCH_NAME" origin/main

echo ""
echo "Clone ready at: $CLONE_DIR"
echo "Branch: $BRANCH_NAME"
echo ""
echo "NEXT: run the repo's setup/bootstrap script before working."
echo "  e.g. for the bun-workspaces monorepo: bun run scripts/setup.ts"
echo "  (or whatever 'mise run dev' / Makefile target the repo uses)"
```

### Working in the Clone

```bash
cd ~/git/<repo>-<feature-slug>

# Run the setup script first — codegen, deps, shared builds, etc.
# Each clone is an independent working tree; nothing is pre-built.
bun run scripts/setup.ts   # for this monorepo specifically

# Make changes, commit, push as usual
git add <files>
git commit -m "feat: ..."
git push -u origin "$(git branch --show-current)"
```

### Creating a PR

```bash
# In the clone directory
gh pr create --fill
gh pr view --web
```

### Completing Work

```bash
#!/bin/bash
# complete-work.sh — run from inside the clone

set -euo pipefail

CLONE_DIR=$(git rev-parse --show-toplevel)
BRANCH=$(git branch --show-current)

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Uncommitted changes — commit or discard first"
  git status
  exit 1
fi

# Confirm PR is merged
if ! gh pr view --json state --jq .state | grep -q MERGED; then
  echo "PR not merged yet"
  gh pr view
  exit 1
fi

# Find the source repo (sibling directory, name without the -<feature> suffix)
PARENT=$(dirname "$CLONE_DIR")
REPO_BASENAME=$(basename "$CLONE_DIR" | sed 's/-[^-]*$//')
SOURCE_REPO="$PARENT/$REPO_BASENAME"

# Step out, delete the clone, prune the local branch in the source (if present)
cd "$SOURCE_REPO"
rm -rf "$CLONE_DIR"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git branch -D "$BRANCH"
fi

echo "Removed $CLONE_DIR and local branch $BRANCH"
```

## Advanced Patterns

### Sibling Layout

Keep clones next to the source for short tab-completion and easy `ls`:

```
~/git/
├── monorepo/                           (main / source)
├── monorepo-feature-auth/              (feature clone)
├── monorepo-fix-login/                 (bugfix clone)
└── monorepo-refactor-api/              (refactor clone)
```

Naming convention: `<repo>-<feature-slug>`. Match the slug to the branch name (`feature/auth` → `monorepo-feature-auth`).

### Status Across All Clones

```bash
#!/bin/bash
# clone-status.sh — show branch and dirty state across all sibling clones

REPO_BASE=${1:-$(basename "$(git rev-parse --show-toplevel)")}
PARENT=$(dirname "$(git rev-parse --show-toplevel)")

for d in "$PARENT/${REPO_BASE}"*/; do
  [ -d "$d/.git" ] || continue
  BRANCH=$(git -C "$d" branch --show-current)
  [ -z "$BRANCH" ] && BRANCH="(detached)"
  if git -C "$d" diff --quiet && git -C "$d" diff --cached --quiet; then
    STATUS="clean"
  else
    STATUS="DIRTY"
  fi
  printf "%-50s %-30s %s\n" "$d" "$BRANCH" "$STATUS"
done
```

### Cleanup of Merged Clones

```bash
#!/bin/bash
# cleanup-merged-clones.sh — remove clones whose branch is merged on remote

set -euo pipefail

REPO_BASE=${1:-$(basename "$(git rev-parse --show-toplevel)")}
PARENT=$(dirname "$(git rev-parse --show-toplevel)")
SOURCE="$PARENT/$REPO_BASE"

git -C "$SOURCE" fetch origin --prune

for d in "$PARENT/${REPO_BASE}-"*/; do
  [ -d "$d/.git" ] || continue
  BRANCH=$(git -C "$d" branch --show-current)
  [ -z "$BRANCH" ] && continue

  # Check if branch is gone from remote (typical after PR merge with auto-delete)
  if ! git -C "$SOURCE" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    echo "Removing merged clone: $d (branch $BRANCH gone from remote)"
    rm -rf "$d"
    if git -C "$SOURCE" show-ref --verify --quiet "refs/heads/$BRANCH"; then
      git -C "$SOURCE" branch -D "$BRANCH"
    fi
  fi
done
```

## AI Agent Workflows

### Parallel Agents in Independent Clones

For multi-agent runs (e.g., 4–5 Claude Code agents working on different features simultaneously), each agent gets a fully independent clone. Unlike worktrees, agents cannot collide on stash, reflog, or in-flight merges.

```bash
# Spin up isolated clones for each agent
git clone --shared --dissociate ~/git/monorepo ~/git/monorepo-agent-1-auth
git clone --shared --dissociate ~/git/monorepo ~/git/monorepo-agent-2-api
git clone --shared --dissociate ~/git/monorepo ~/git/monorepo-agent-3-ui

# In each clone:
#   1. set origin to the real remote
#   2. fetch --prune
#   3. branch from origin/main
#   4. run the repo's setup script
#   5. agent works in full isolation
```

**Isolation guarantees** (vs worktrees):

- Agent A's `git stash push` does not appear in Agent B's stash list.
- Agent A's reflog is not interleaved with Agent B's HEAD movements.
- Agent A's `git gc` cannot touch Agent B's packs.
- Agents can run merges/rebases simultaneously without "another git process is running" errors.

**Cost** (vs worktrees):

- Each clone needs its own object store (~600 MB for the monorepo).
- Each clone needs its own setup run (codegen, `node_modules`, build outputs, `target/`) — typically 15–20 GB and several minutes per clone.

For short tasks where setup time dominates, worktrees may still be appropriate. For multi-day features and parallel-agent runs, the isolation is worth the disk.

## Integration with PR Workflow

### Combined `feature.sh start|pr|done`

```bash
#!/bin/bash
# feature.sh <command> [name]
# Commands: start, pr, done

set -euo pipefail

COMMAND=${1:?Usage: feature.sh <start|pr|done> [name]}

case $COMMAND in
  start)
    NAME=${2:?Usage: feature.sh start <feature-name>}
    SOURCE=$(git rev-parse --show-toplevel)
    PARENT=$(dirname "$SOURCE")
    BASE=$(basename "$SOURCE")
    REMOTE=$(git -C "$SOURCE" remote get-url origin)
    DEST="$PARENT/${BASE}-${NAME}"

    git clone --shared --dissociate "$SOURCE" "$DEST"
    cd "$DEST"
    git remote set-url origin "$REMOTE"
    git fetch origin --prune
    git switch -c "feature/$NAME" origin/main

    echo "Clone ready at $DEST"
    echo "Run the repo setup script before working (e.g. bun run scripts/setup.ts)"
    ;;

  pr)
    BRANCH=$(git branch --show-current)
    git push -u origin "$BRANCH"
    gh pr create --fill
    gh pr view
    ;;

  done)
    BRANCH=$(git branch --show-current)
    CLONE=$(git rev-parse --show-toplevel)

    if ! git diff --quiet || ! git diff --cached --quiet; then
      echo "Uncommitted changes — aborting"
      exit 1
    fi

    if ! gh pr view --json state --jq .state | grep -q MERGED; then
      echo "PR not merged yet"
      exit 1
    fi

    PARENT=$(dirname "$CLONE")
    BASE=$(basename "$CLONE" | sed 's/-[^-]*$//')
    SOURCE="$PARENT/$BASE"

    cd "$SOURCE"
    rm -rf "$CLONE"
    if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
      git branch -D "$BRANCH"
    fi
    echo "Removed $CLONE and local branch $BRANCH"
    ;;

  *)
    echo "Usage: feature.sh <start|pr|done> [name]"
    exit 1
    ;;
esac
```

## Best Practices

### 1. Always Re-point `origin` After Clone

`--shared <local-path>` sets `origin` to the local path. If you skip the `git remote set-url`, `git push` will push to the local source, not GitHub. Always run:

```bash
git remote set-url origin <real-remote-url>
git fetch origin --prune
```

The `--prune` is important: cloning from a non-bare source brings the source's local-only branches over as `remotes/origin/*` refs. Pruning against the real remote drops them.

### 2. Run the Repo Setup Script Before Working

Each clone has an empty working tree (no `node_modules`, no codegen, no compiled artifacts). **Tell the user (or your future self): run the repo's setup script before any `bun run`, `cargo build`, or `pytest`.**

For this monorepo specifically:

```bash
bun run scripts/setup.ts   # or: mise run dev
```

For other repos: look for `Makefile` targets like `make setup`, `make install`, or `bin/setup` scripts. Without this, builds fail with cryptic missing-dependency errors.

### 3. Don't gc the Source While Clones Exist (Pre-Dissociate Only)

This caveat applies only if you skip `--dissociate`. With `--dissociate`, the alternates link is gone — the source can be gc'd, deleted, or moved without affecting any clone. **Always pass `--dissociate`** unless you have a specific reason to keep the link.

### 4. Use Distinct Branches Per Clone

Each clone is independent, but the remote is shared. Two clones working on the same branch will collide when pushing. Use distinct branch names per clone (`feature/auth`, `feature/auth-v2`, etc.).

### 5. Sibling Layout, Not Nested

```
✅ ~/git/monorepo/                    (source)
✅ ~/git/monorepo-feature-auth/       (clone — sibling)

❌ ~/git/monorepo/feature-auth/       (clone inside source — confusing, breaks tooling)
```

## Common Workflows

### Quick Bug Fix

```bash
git clone --shared --dissociate ~/git/monorepo ~/git/monorepo-fix-critical
cd ~/git/monorepo-fix-critical
git remote set-url origin git@github.com:USER/monorepo.git
git fetch origin --prune
git switch -c fix/critical origin/main
bun run scripts/setup.ts

# fix, commit, push, PR
git add <files>
git commit -m "fix: critical bug"
git push -u origin fix/critical
gh pr create --fill

# After merge
cd ~/git/monorepo
rm -rf ~/git/monorepo-fix-critical
git branch -D fix/critical
```

### Long-Running Feature with Periodic Rebase

```bash
cd ~/git/monorepo-feature-big

# Keep up with main (clone has its own fetch/refs)
git fetch origin
git rebase origin/main

# Or merge if you prefer
git merge origin/main
```

The shared-stash worry that motivates this skill is loudest during merges — clones make those safe.

### Parallel Features

```bash
# Three clones, three branches, three setup runs — but full isolation
git clone --shared --dissociate ~/git/monorepo ~/git/monorepo-feat-api
git clone --shared --dissociate ~/git/monorepo ~/git/monorepo-feat-ui
git clone --shared --dissociate ~/git/monorepo ~/git/monorepo-feat-docs

# In each clone:
#   git remote set-url origin <remote>
#   git fetch origin --prune
#   git switch -c <branch> origin/main
#   bun run scripts/setup.ts
```

## Troubleshooting

### Issue: `git push` pushed to a local path, not GitHub

You forgot `git remote set-url origin <remote>`. Fix it now:

```bash
git remote set-url origin git@github.com:USER/REPO.git
git fetch origin --prune
git push -u origin "$(git branch --show-current)"
```

### Issue: `remotes/origin/<weird-branch>` showing branches that don't exist on GitHub

Cloning from a non-bare source brings local-only branches over as remote-tracking refs. Run `git fetch origin --prune` after re-pointing the remote — `--prune` drops refs that don't exist on the real remote.

### Issue: Builds fail with missing modules / generated files

You skipped the repo setup script. Run it:

```bash
# This monorepo:
bun run scripts/setup.ts
# Or its mise alias:
mise run dev
```

### Issue: Disk filling up

Each clone is ~20 GB after setup. If you have many clones, run cleanup:

```bash
# Remove merged clones (script in Advanced Patterns section)
./cleanup-merged-clones.sh
```

For per-clone cleanup of build artifacts without removing the clone itself, run the repo's clean script (e.g., `bun run clean` or `cargo clean` in Rust packages).

### Issue: I forgot `--dissociate` and the source got gc'd

Symptom: `error: object <hash> missing` in the clone.

Recovery:

```bash
cd <clone>
# Drop the alternates link
rm .git/objects/info/alternates
# Re-fetch from origin to repopulate the missing objects
git fetch origin --prune
# Verify
git fsck
```

If the missing objects are in commits that aren't on `origin`, they're gone — restore from a backup or re-clone.

### Issue: I want to verify dissociate worked

```bash
ls .git/objects/info/alternates 2>&1
# expected: "No such file or directory"

git fsck --no-dangling
# expected: silent (clean)
```

## When to Ask for Help

Ask the user for clarification when:

- The repo's setup script is unclear (no `Makefile`, no `scripts/setup.*`, no docs).
- The remote URL convention is unclear (HTTPS vs SSH, GitHub vs internal Gitea).
- Disk pressure makes per-clone setup costs prohibitive — worktrees may still be appropriate.
- The user has long-lived clones and wants a consolidation/cleanup pass.
