---
description: Assists with GitHub CLI (gh) for PR management, issues, and workflows
when_to_use: When user mentions GitHub, pull requests, gh command, or repository operations
---

# GitHub CLI Helper Agent

## What's New in 2025

- **Clipboard OAuth**: `gh auth login --clipboard` auto-copies OAuth code
- **New Commands**: `gh agent-task`, `gh attestation`, `gh ruleset` (v2.50+)
- **Security**: Build Provenance Attestation support
- **Customization**: `gh alias set` and `gh config set editor` for workflows
- **Web Bridge**: `gh browse` connects terminal and GitHub web interface
- **GitHub Copilot CLI**: Integrated AI assistance (replaces gh-copilot extension)

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
- `gh attestation verify` - Verify build provenance
- `gh browse` - Open repository in browser

### Authentication and Setup

**Login with clipboard (2025)**:
```bash
# OAuth code automatically copied to clipboard
gh auth login --clipboard

# Traditional login
gh auth login

# Check authentication status
gh auth status
```

**Customize your environment**:
```bash
# Set default editor
gh config set editor "code --wait"
gh config set editor "vim"

# Create aliases for common commands
gh alias set prs 'pr list --author @me'
gh alias set issues 'issue list --assignee @me'
gh alias set co 'pr checkout'

# Use your aliases
gh prs
gh co 123
```

**Browse GitHub from terminal**:
```bash
# Open current repo in browser
gh browse

# Open specific PR
gh browse 123

# Open issues page
gh browse -- issues

# Open settings
gh browse -- settings
```

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

## Advanced Features (2025)

### Build Provenance and Attestation (v2.50+)

Verify software supply chain security:

```bash
# Verify attestation for an artifact
gh attestation verify <artifact-path> --owner <org>

# View attestation details
gh attestation inspect <artifact-path>

# Attest to a build (in CI/CD)
gh attestation sign <artifact-path> --repo <org/repo>
```

**Use cases:**
- Verify npm packages before installation
- Validate container images before deployment
- Audit software supply chain in enterprise

### Repository Rulesets

Manage branch protection and repository rules:

```bash
# List rulesets
gh ruleset list

# View ruleset details
gh ruleset view <ruleset-id>

# Check ruleset applicability
gh ruleset check <branch-name>
```

**Benefits:**
- Consistent rules across multiple repos
- Reusable security policies
- Better compliance reporting

### Agent Tasks (Enterprise)

For GitHub Enterprise with agent runners:

```bash
# Create agent task
gh agent-task create --name "Deploy" --script deploy.sh

# List agent tasks
gh agent-task list

# View agent task logs
gh agent-task view <task-id>
```

### GitHub Copilot CLI Integration

GitHub Copilot is now integrated directly into gh CLI (replaces deprecated gh-copilot extension):

```bash
# Get shell command suggestions
gh copilot suggest "list all files modified in last commit"

# Explain a command
gh copilot explain "git rebase -i HEAD~3"

# Generate git commands
gh copilot suggest git "undo last commit but keep changes"
```

**Setup**:
```bash
# Copilot is included in gh CLI by default (v2.46+)
# Requires GitHub Copilot subscription

# Check Copilot status
gh copilot --help
```

## Best Practices

1. **Use Templates**: Set up PR and issue templates in `.github/` directory
2. **Customize gh CLI**: Set up aliases and editor configuration early
   ```bash
   gh alias set prs 'pr list --author @me'
   gh config set editor "code --wait"
   ```
3. **Descriptive Titles**: Use clear, actionable PR/issue titles
4. **Link Issues**: Reference related issues in PR descriptions using `#issue-number`
5. **Verify Artifacts**: Use `gh attestation verify` for supply chain security (v2.50+)
6. **Check Status**: Always check PR checks before merging
   ```bash
   gh pr checks --watch  # Wait for completion
   ```
7. **Bridge Terminal and Web**: Use `gh browse` to quickly jump to GitHub web interface
8. **Clean Branches**: Delete feature branches after merging
   ```bash
   gh pr merge --squash --delete-branch
   ```

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
