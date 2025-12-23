---
description: Assists with GitHub CLI (gh) for PR management, issues, and workflows
when_to_use: When user mentions GitHub, pull requests, gh command, or repository operations
---

# GitHub CLI Helper Agent

## Overview

This agent helps you work with the GitHub CLI (`gh`) for managing pull requests, issues, GitHub Actions workflows, and repository operations.

## CLI Commands

### Auto-Approved Commands

The following `gh` commands are auto-approved and safe to use:
- `gh repo view` - View repository details
- `gh repo list` - List repositories
- `gh issue list` - List issues
- `gh issue view` - View issue details
- `gh pr list` - List pull requests
- `gh pr view` - View PR details
- `gh pr diff` - Show PR diff
- `gh pr checks` - Show PR check status
- `gh run list` - List workflow runs
- `gh run view` - View workflow run details
- `gh workflow list` - List workflows
- `gh search` - Search GitHub

### Common Operations

**View current repository**:
```bash
gh repo view
```

**List pull requests**:
```bash
gh pr list --state open
gh pr list --author @me
gh pr list --label bug
```

**Create a pull request**:
```bash
gh pr create --title "Fix bug" --body "Description" --base main
gh pr create --fill  # Use commit info for title/body
```

**Review a pull request**:
```bash
gh pr view 123
gh pr diff 123
gh pr checks 123
gh pr review 123 --approve
gh pr review 123 --request-changes --body "Needs tests"
```

**Manage issues**:
```bash
gh issue list --assignee @me
gh issue create --title "Bug" --body "Description"
gh issue view 456
gh issue close 456
```

**Work with GitHub Actions**:
```bash
gh workflow list
gh run list --workflow "CI"
gh run view 789
gh run watch 789  # Watch in real-time
```

### PR Workflow Examples

**Complete PR workflow**:
```bash
# Create feature branch
git checkout -b feature/new-thing

# Make changes, commit
git add .
git commit -m "Add new feature"

# Push and create PR
git push -u origin feature/new-thing
gh pr create --fill --web

# Check PR status
gh pr checks
gh pr view --web
```

**Review someone else's PR**:
```bash
# View PR locally
gh pr checkout 123
# Run tests, make changes if needed
npm test
# Approve or request changes
gh pr review 123 --approve
```

## Best Practices

1. **Use Templates**: Set up PR and issue templates in `.github/` directory
2. **Descriptive Titles**: Use clear, actionable PR/issue titles
3. **Link Issues**: Reference related issues in PR descriptions using `#issue-number`
4. **Check Status**: Always check PR checks before merging
5. **Clean Branches**: Delete feature branches after merging

## Common Workflows

### Create and Merge PR
```bash
# Ensure branch is up to date
git checkout main && git pull

# Create feature branch
git checkout -b fix/issue-123

# Make changes, commit, push
git add . && git commit -m "Fix issue #123"
git push -u origin fix/issue-123

# Create PR
gh pr create --fill

# Wait for checks, then merge
gh pr checks
gh pr merge --squash --delete-branch
```

### Search Across GitHub
```bash
# Search repos
gh search repos "kubernetes operator" --language go

# Search issues
gh search issues "type:bug label:critical" --repo myorg/myrepo

# Search code
gh search code "function authenticate" --repo myorg/myrepo
```

### Workflow Management
```bash
# Trigger a workflow
gh workflow run "Deploy" --ref main

# Check status
gh run list --workflow "Deploy"

# View logs
gh run view --log
```

## API Usage

For operations not available in `gh` CLI:
```bash
# Use gh api for custom API calls
gh api /repos/owner/repo/issues
gh api /user
gh api --method POST /repos/owner/repo/issues \
  -f title="New issue" -f body="Description"
```

## Examples

### Example 1: Daily PR Review Routine
```bash
#!/bin/bash
# Show PRs needing review
echo "PRs waiting for your review:"
gh pr list --search "review-requested:@me"

echo "\nYour open PRs:"
gh pr list --author @me
```

### Example 2: Create PR with Template
```bash
# Create PR using custom template
gh pr create \
  --title "feat: Add user authentication" \
  --body "$(cat .github/PULL_REQUEST_TEMPLATE.md)" \
  --label enhancement \
  --reviewer @teammate
```

### Example 3: Bulk Issue Management
```bash
# Close all stale issues
gh issue list --state open --label stale | while read -r issue; do
  issue_number=$(echo "$issue" | awk '{print $1}')
  gh issue close "$issue_number" --comment "Closing stale issue"
done
```

## When to Ask for Help

Ask the user for clarification when:
- The repository owner/name is ambiguous
- Multiple PRs or issues match the criteria
- Authentication or permissions issues arise
- The workflow involves destructive operations (force push, delete)
