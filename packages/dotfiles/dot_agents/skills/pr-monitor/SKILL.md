---
name: pr-monitor
description: |
  Monitor a PR through reviews and merge conflicts until ready for human review.
  Use when user says "monitor PR", "watch PR", or wants automated PR workflow.
  Creates PR if needed, then monitors review comments and merge conflicts.
  Note: this monorepo's CI runs on Buildkite (`buildkite/monorepo/pr` + `ci/merge-conflict`) per PR — watch it via `bk build view` or the Buildkite web UI, not `gh run`.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Task
---

# PR Monitor Skill

> **Branch & PR management in `shepherdjerred/monorepo` uses git-spice — every PR is a stacked PR.** Load the `git-spice-helper` skill first (it's authoritative); create/update PRs with `git-spice branch/stack submit` — a single PR is a stack of one. The `gh pr create` and manual-`git rebase` examples below are the generic fallback for repos without git-spice.

Automates the complete PR workflow: create PR, monitor reviews/conflicts, fix issues, and notify when ready.

> **CI in this monorepo.** Buildkite runs `buildkite/monorepo/pr` + `ci/merge-conflict` per PR — `gh pr checks` shows them, but use `bk build view` / the Buildkite web UI for logs (`toolkit pr logs` targets GitHub Actions run IDs and won't resolve a Buildkite build). Also run the touched packages' typecheck/test/lint locally before and during monitoring — CI catches the rest, but local verification is faster to iterate on.

## Workflow

When invoked:

1. **Create PR** (if not already created)
   - Push current branch to remote
   - Create PR with `gh pr create`

2. **Monitor Loop** (every 60 seconds)
   Check two things and resolve issues found:

   ### A. Review Comments & Approval
   - Check for automated Claude Code review comments with `gh pr view --json reviews,reviewDecision`
   - Address ALL issues found by automated reviews
   - PR is NOT approved until it has a GitHub approval status
   - Note: PR may be approved then have changes requested after revisions

   ### B. Merge Conflicts
   - Check if behind main with `git fetch origin main && git merge-base --is-ancestor origin/main HEAD`
   - If behind, merge from main and resolve any conflicts that arise
   - YOU are responsible for merge conflicts, not the user

3. **Completion Check**
   - Verify BOTH checks pass simultaneously
   - No new automated issues/concerns
   - Only then notify user

4. **Notify User**
   - Report PR is ready for human review
   - Provide PR title and URL

## Commands Reference

### Create/Check PR

```bash
# Push branch
git push -u origin $(git branch --show-current)

# Create PR
gh pr create --fill

# Check if PR exists
gh pr view --json number,url
```

### Check Reviews

```bash
# Get review status
gh pr view --json reviews,reviewDecision

# List review comments
gh api repos/{owner}/{repo}/pulls/{number}/comments

# Check if approved
gh pr view --json reviewDecision --jq '.reviewDecision'
```

### Handle Merge Conflicts

```bash
# Fetch latest main
git fetch origin main

# Check if behind main
git merge-base --is-ancestor origin/main HEAD && echo "Up to date" || echo "Need to merge"

# Merge from main
git merge origin/main

# After resolving conflicts
git add .
git commit -m "Merge main and resolve conflicts"
git push
```

### Amend and Push

```bash
# Stage changes
git add .

# Amend commit
git commit --amend --no-edit

# Force push
git push --force-with-lease
```

## Important Notes

1. **CI**: Buildkite runs `buildkite/monorepo/pr` + `ci/merge-conflict` per PR — check via `bk build view` or the Buildkite web UI, not `gh run`. Also run the touched packages' `bun run typecheck` / `test` / `bunx eslint .` locally to iterate faster than waiting on CI.

2. **Automated Reviews**: Claude Code automated reviews must ALL be addressed. The PR isn't approved until GitHub shows an approval.

3. **Approval State**: A PR may be approved, then after you make changes, it may have "changes requested" status again. Keep iterating.

4. **Merge Conflicts**: Always resolve these yourself rather than asking the user.

5. **Polling Interval**: Check every 60 seconds to avoid rate limiting while still being responsive.

6. **Final Verification**: Before notifying the user, double-check that:
   - Local verification (typecheck/test/lint for touched packages) passes
   - PR has GitHub approval
   - No merge conflicts with main
   - No outstanding review comments
