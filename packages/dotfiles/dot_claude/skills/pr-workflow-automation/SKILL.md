---
name: pr-workflow-automation
description: |
  Automated PR workflow with CI monitoring, amendments, and retry logic
  When user asks to create a PR, merge changes, or needs CI-aware PR management
---

# PR Workflow Automation Agent

## Overview

This agent automates the complete pull request workflow: pushing changes, creating PRs, monitoring CI status, and automatically fixing failures through amendments and retries until CI passes.

## Core Workflow

When creating a PR, follow this automated workflow:

1. **Push changes** to remote branch
2. **Create pull request** with GitHub CLI
3. **Monitor CI status** by polling GitHub Actions
4. **On CI failure**: Amend commit, force push, repeat
5. **On CI success**: Report completion

## CLI Commands

### Push and Create PR

```bash
# Push current branch to remote
git push -u origin $(git branch --show-current)

# Create PR with gh CLI
gh pr create --fill

# Create PR with custom title and body
gh pr create --title "feat: add new feature" --body "Description of changes"

# Create draft PR
gh pr create --draft --fill

# Auto-fill from commits
gh pr create --fill-first
```

### Monitor CI Status

```bash
# Check PR status (shows all checks)
gh pr checks

# Watch checks in real-time
gh pr checks --watch

# Get check status as JSON
gh pr checks --json name,status,conclusion

# View specific workflow run
gh run view <run-id>

# Watch workflow run
gh run watch <run-id>
```

### Get Latest Workflow Run

```bash
# Get latest run for current PR
gh run list --branch $(git branch --show-current) --limit 1

# Get run ID and status
gh run list --branch $(git branch --show-current) --limit 1 --json databaseId,status,conclusion

# Filter by workflow
gh run list --workflow ci.yml --branch $(git branch --show-current) --limit 1
```

### Amend and Force Push

```bash
# Amend last commit (keep message)
git commit --amend --no-edit

# Amend with new changes
git add .
git commit --amend --no-edit

# Force push to update PR
git push --force-with-lease

# Force push (less safe)
git push -f
```

## Complete PR Workflow Script

```bash
#!/bin/bash
set -euo pipefail

# Configuration
MAX_RETRIES=5
POLL_INTERVAL=30  # seconds
BRANCH=$(git branch --show-current)

echo "Starting PR workflow for branch: $BRANCH"

# Step 1: Push branch
echo "Pushing changes..."
git push -u origin "$BRANCH"

# Step 2: Create PR (if doesn't exist)
if ! gh pr view &>/dev/null; then
  echo "Creating pull request..."
  gh pr create --fill
else
  echo "PR already exists, updating..."
fi

# Step 3: Monitor and retry loop
attempt=1
while [ $attempt -le $MAX_RETRIES ]; do
  echo "Attempt $attempt/$MAX_RETRIES: Waiting for CI..."

  # Wait for checks to start
  sleep 10

  # Poll for completion
  while true; do
    # Get check status
    status=$(gh pr checks --json status,conclusion --jq '
      if all(.status == "COMPLETED") then
        if all(.conclusion == "SUCCESS") then "SUCCESS"
        else "FAILURE"
        end
      else "PENDING"
      end
    ')

    echo "CI Status: $status"

    if [ "$status" = "SUCCESS" ]; then
      echo "✅ CI passed! PR is ready."
      exit 0
    elif [ "$status" = "FAILURE" ]; then
      echo "❌ CI failed on attempt $attempt"
      break
    fi

    # Keep polling
    sleep $POLL_INTERVAL
  done

  # CI failed - attempt to fix
  if [ $attempt -lt $MAX_RETRIES ]; then
    echo "Attempting automatic fix..."

    # Get failure details
    echo "Failure details:"
    gh pr checks

    # This is where you'd implement automatic fixes
    # For now, we'll just ask the user
    echo ""
    echo "CI failed. Please fix the issues, then press Enter to amend and retry..."
    read -r

    # Amend and push
    echo "Amending commit and retrying..."
    git add -A
    git commit --amend --no-edit
    git push --force-with-lease

    attempt=$((attempt + 1))
  else
    echo "❌ Max retries reached. Manual intervention required."
    exit 1
  fi
done
```

## Advanced Patterns

### Automatic Fix Detection

```bash
# Check if linting fixes are needed
if gh pr checks --json name,conclusion --jq '.[] | select(.name == "lint" and .conclusion == "FAILURE")' | grep -q .; then
  echo "Lint failures detected, running auto-fix..."
  bun run lint:fix
  git add -A
  git commit --amend --no-edit
  git push --force-with-lease
fi

# Check if type errors exist
if gh pr checks --json name,conclusion --jq '.[] | select(.name == "typecheck" and .conclusion == "FAILURE")' | grep -q .; then
  echo "Type check failures detected"
  # Type errors usually need manual fixes
fi
```

### Wait for Specific Check

```bash
# Wait for specific workflow to complete
check_name="ci"

while true; do
  status=$(gh pr checks --json name,status,conclusion --jq "
    .[] | select(.name == \"$check_name\") |
    if .status == \"COMPLETED\" then
      .conclusion
    else
      \"PENDING\"
    end
  ")

  case $status in
    SUCCESS)
      echo "✅ $check_name passed"
      break
      ;;
    FAILURE)
      echo "❌ $check_name failed"
      exit 1
      ;;
    PENDING|IN_PROGRESS)
      echo "⏳ Waiting for $check_name..."
      sleep 30
      ;;
  esac
done
```

### Get Failure Logs

```bash
# Get failed job logs
failed_run=$(gh run list --branch $(git branch --show-current) \
  --limit 1 --json databaseId,conclusion --jq \
  'select(.conclusion == "FAILURE") | .databaseId')

if [ -n "$failed_run" ]; then
  echo "Fetching logs for failed run: $failed_run"
  gh run view "$failed_run" --log-failed
fi
```

### Parallel Check Monitoring

```bash
# Monitor multiple checks simultaneously
checks=("lint" "typecheck" "test" "build")

for check in "${checks[@]}"; do
  (
    echo "Monitoring $check..."
    gh run watch --workflow "$check.yml" --exit-status
  ) &
done

# Wait for all background jobs
wait

echo "All checks completed"
```

## Integration with Dagger

For projects using Dagger CI:

```bash
# The workflow typically calls a single Dagger command
# Monitor the main CI workflow
gh run watch --workflow ci.yml --exit-status

# Or check specific Dagger job output
gh run view --log | grep "dagger call"
```

## Best Practices

### 1. Force Push Safety

```bash
# Always use --force-with-lease instead of -f
# This prevents overwriting changes you haven't seen
git push --force-with-lease

# Even safer: check if remote has changed
if git fetch origin && git diff origin/$BRANCH --quiet; then
  git push --force-with-lease
else
  echo "⚠️  Remote branch has new commits. Pull first!"
  exit 1
fi
```

### 2. Commit Message Preservation

```bash
# When amending, preserve the commit message
git commit --amend --no-edit

# If you need to update the message during retry
git commit --amend -m "fix: address CI failures"
```

### 3. Clean Retry State

```bash
# Before each retry, ensure clean state
git status --porcelain | grep -q . && git add -A
git diff --cached --quiet || git commit --amend --no-edit
```

### 4. Timeout Protection

```bash
# Set maximum wait time for CI
TIMEOUT=1800  # 30 minutes
START_TIME=$(date +%s)

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))

  if [ $ELAPSED -gt $TIMEOUT ]; then
    echo "⏰ Timeout: CI took longer than 30 minutes"
    exit 1
  fi

  # Check status...
  sleep 30
done
```

### 5. Retry Backoff

```bash
# Increase wait time between retries
RETRY_DELAY=60
for attempt in $(seq 1 $MAX_RETRIES); do
  # ... check CI ...

  if [ $attempt -lt $MAX_RETRIES ]; then
    wait_time=$((RETRY_DELAY * attempt))
    echo "Waiting ${wait_time}s before retry..."
    sleep $wait_time
  fi
done
```

## Common Scenarios

### Scenario 1: Lint Failures

```bash
# Detect lint failure
if gh pr checks --json name,conclusion | jq -e '.[] | select(.name | contains("lint")) | select(.conclusion == "FAILURE")'; then
  echo "Running lint fix..."
  bun run lint:fix
  git add -A
  git commit --amend --no-edit
  git push --force-with-lease
fi
```

### Scenario 2: Test Failures

```bash
# Test failures usually need manual fix
echo "❌ Tests failed. Common fixes:"
echo "  1. Run tests locally: bun test"
echo "  2. Check test output: gh run view --log"
echo "  3. Fix issues and amend: git commit --amend --no-edit"
echo "  4. Push: git push --force-with-lease"
```

### Scenario 3: Build Failures

```bash
# Build failures
echo "❌ Build failed. Checking for common issues..."

# Check if dependencies need updating
if gh run view --log | grep -q "Cannot find module"; then
  echo "Installing dependencies..."
  bun install
  git add bun.lockb
  git commit --amend --no-edit
  git push --force-with-lease
fi
```

## Complete Example: Auto-Fixing PR

```bash
#!/bin/bash
# pr-auto-fix.sh - Complete PR workflow with auto-fixes

set -euo pipefail

BRANCH=$(git branch --show-current)
MAX_RETRIES=3

# Ensure we have changes
if ! git diff --cached --quiet || ! git diff --quiet; then
  git add -A
  git commit || {
    echo "Nothing to commit"
    exit 0
  }
fi

# Push and create PR
git push -u origin "$BRANCH"
gh pr view &>/dev/null || gh pr create --fill

# Retry loop
for attempt in $(seq 1 $MAX_RETRIES); do
  echo "=== Attempt $attempt/$MAX_RETRIES ==="

  # Wait for checks to start
  echo "Waiting for CI to start..."
  sleep 15

  # Monitor until completion
  gh pr checks --watch || true

  # Get final status
  failures=$(gh pr checks --json name,conclusion --jq '
    [.[] | select(.conclusion == "FAILURE") | .name] | join(", ")
  ')

  if [ -z "$failures" ]; then
    echo "✅ All checks passed!"
    exit 0
  fi

  echo "❌ Failed checks: $failures"

  # Attempt auto-fixes
  fixed=false

  # Auto-fix lint
  if echo "$failures" | grep -qi "lint"; then
    echo "Auto-fixing lint issues..."
    bun run lint:fix && fixed=true
  fi

  # Auto-fix formatting
  if echo "$failures" | grep -qi "format"; then
    echo "Auto-fixing format issues..."
    bun run format && fixed=true
  fi

  # If we made fixes, commit and retry
  if $fixed && ! git diff --quiet; then
    git add -A
    git commit --amend --no-edit
    git push --force-with-lease
    echo "Pushed fixes, retrying..."
    continue
  fi

  # Manual intervention needed
  if [ $attempt -lt $MAX_RETRIES ]; then
    echo ""
    echo "Could not auto-fix. Please make changes and press Enter to retry..."
    read -r

    git add -A
    git commit --amend --no-edit
    git push --force-with-lease
  fi
done

echo "❌ Max retries reached. Manual intervention required."
echo "View failures: gh pr checks"
exit 1
```

## When to Ask for Help

Ask the user for clarification when:

- CI failures are not automatically fixable (type errors, test logic issues)
- Maximum retry attempts reached
- PR creation fails (authentication, permissions)
- Branch protection rules prevent force push
- Conflicts exist with base branch
- Custom CI workflows with non-standard check names
