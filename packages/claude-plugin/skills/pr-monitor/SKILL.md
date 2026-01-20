---
name: pr-monitor
description: |
  Monitor a PR through CI, reviews, and merge conflicts until ready for human review.
  Use when user says "monitor PR", "watch PR", "wait for CI", or wants automated PR workflow.
  Creates PR if needed, then monitors Dagger CI, automated review comments, and merge conflicts.
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

Automates the complete PR workflow: create PR, monitor CI/reviews/conflicts, fix issues, and notify when ready.

## Workflow

When invoked:

1. **Create PR** (if not already created)
   - Push current branch to remote
   - Create PR with `gh pr create`

2. **Monitor Loop** (every 60 seconds)
   Check three things and resolve issues found:

   ### A. Dagger CI Status
   - Run `gh pr checks` to see CI status
   - If CI is running, wait for completion
   - If CI fails, investigate logs with `gh run view <run-id> --log`
   - **IMPORTANT**: Errors about "url params" or "GraphQL" are misleading - look for the actual error higher in the logs
   - Fix any issues found and push amendments

   ### B. Review Comments & Approval
   - Check for automated Claude Code review comments with `gh pr view --json reviews,reviewDecision`
   - Address ALL issues found by automated reviews
   - PR is NOT approved until it has a GitHub approval status
   - Note: PR may be approved then have changes requested after revisions

   ### C. Merge Conflicts
   - Check if behind main with `git fetch origin main && git merge-base --is-ancestor origin/main HEAD`
   - If behind, merge from main and resolve any conflicts that arise
   - YOU are responsible for merge conflicts, not the user

3. **Completion Check**
   - Verify ALL THREE checks pass simultaneously
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

### Monitor CI
```bash
# Check all PR checks
gh pr checks

# Get detailed status
gh pr checks --json name,status,conclusion

# View failed run logs
gh run list --limit 1 --json databaseId,conclusion
gh run view <run-id> --log
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

1. **Misleading CI Errors**: "url params" or "GraphQL" errors from Dagger are usually not the root cause. Scroll up in logs to find the actual failure.

2. **Automated Reviews**: Claude Code automated reviews must ALL be addressed. The PR isn't approved until GitHub shows an approval.

3. **Approval State**: A PR may be approved, then after you make changes, it may have "changes requested" status again. Keep iterating.

4. **Merge Conflicts**: Always resolve these yourself rather than asking the user.

5. **Polling Interval**: Check every 60 seconds to avoid rate limiting while still being responsive.

6. **Final Verification**: Before notifying the user, double-check that:
   - CI is green
   - PR has GitHub approval
   - No merge conflicts with main
   - No outstanding review comments
