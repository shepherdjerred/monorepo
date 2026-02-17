---
name: gh-helper
description: |
  Complete GitHub operations via gh CLI - repos, issues, PRs, code search, actions, file management
  When user mentions GitHub, repositories, issues, PRs, gh command, code search, commits, file contents
---

# GitHub CLI Helper Agent

## Overview

Complete GitHub operations via `gh` CLI and GitHub API. This skill replaces GitHub MCP server functionality, providing CLI/API equivalents for all operations.

## MCP Tool Equivalents Reference

| MCP Tool                     | CLI/API Equivalent                                                 |
| ---------------------------- | ------------------------------------------------------------------ |
| `create_or_update_file`      | `gh api -X PUT /repos/{owner}/{repo}/contents/{path}`              |
| `search_repositories`        | `gh search repos <query>`                                          |
| `create_repository`          | `gh repo create <name>`                                            |
| `get_file_contents`          | `gh api /repos/{owner}/{repo}/contents/{path}`                     |
| `push_files`                 | `git add && git commit && git push`                                |
| `create_issue`               | `gh issue create`                                                  |
| `create_pull_request`        | `gh pr create`                                                     |
| `fork_repository`            | `gh repo fork`                                                     |
| `create_branch`              | `gh api -X POST /repos/{owner}/{repo}/git/refs`                    |
| `list_commits`               | `gh api /repos/{owner}/{repo}/commits`                             |
| `list_issues`                | `gh issue list`                                                    |
| `update_issue`               | `gh issue edit`                                                    |
| `add_issue_comment`          | `gh issue comment`                                                 |
| `search_code`                | `gh search code <query>`                                           |
| `search_issues`              | `gh search issues <query>`                                         |
| `search_users`               | `gh api /search/users?q=<query>`                                   |
| `get_issue`                  | `gh issue view <number>`                                           |
| `get_pull_request`           | `gh pr view <number>`                                              |
| `list_pull_requests`         | `gh pr list`                                                       |
| `create_pull_request_review` | `gh pr review`                                                     |
| `merge_pull_request`         | `gh pr merge`                                                      |
| `get_pull_request_files`     | `gh api /repos/{owner}/{repo}/pulls/{number}/files`                |
| `get_pull_request_status`    | `gh pr checks`                                                     |
| `update_pull_request_branch` | `gh api -X PUT /repos/{owner}/{repo}/pulls/{number}/update-branch` |
| `get_pull_request_comments`  | `gh api /repos/{owner}/{repo}/pulls/{number}/comments`             |
| `get_pull_request_reviews`   | `gh api /repos/{owner}/{repo}/pulls/{number}/reviews`              |

## Auto-Approved Commands

Safe read-only commands:

- `gh repo view`, `gh repo list`
- `gh issue list`, `gh issue view`
- `gh pr list`, `gh pr view`, `gh pr diff`, `gh pr checks`
- `gh run list`, `gh run view`, `gh run watch`
- `gh workflow list`, `gh workflow view`
- `gh release list`, `gh release view`
- `gh search repos`, `gh search code`, `gh search issues`
- `gh status`

---

## Repository Operations

### Search Repositories

```bash
# Basic search
gh search repos "kubernetes operator"

# With filters
gh search repos "react" --language typescript --stars ">1000"
gh search repos "cli tool" --owner hashicorp
gh search repos "mcp server" --topic model-context-protocol

# JSON output for parsing
gh search repos "query" --json fullName,description,stargazersCount
```

### Create Repository

```bash
# Interactive creation
gh repo create

# Create with options
gh repo create my-repo --public --description "My project"
gh repo create my-repo --private --clone

# Create from template
gh repo create my-repo --template owner/template-repo

# Create org repo
gh repo create my-org/my-repo --public
```

### Fork Repository

```bash
# Fork to your account
gh repo fork owner/repo

# Fork and clone
gh repo fork owner/repo --clone

# Fork to organization
gh repo fork owner/repo --org my-org

# Fork with custom name
gh repo fork owner/repo --fork-name my-fork
```

### Get File Contents

```bash
# Get file content via API (returns base64)
gh api /repos/{owner}/{repo}/contents/{path} | jq -r '.content' | base64 -d

# Get file from specific branch
gh api /repos/{owner}/{repo}/contents/{path}?ref=branch-name

# Get directory listing
gh api /repos/{owner}/{repo}/contents/{path}

# Get raw file content
gh api /repos/{owner}/{repo}/contents/{path} -H "Accept: application/vnd.github.raw"
```

### Create or Update File

```bash
# Create new file
gh api -X PUT /repos/{owner}/{repo}/contents/{path} \
  -f message="Add new file" \
  -f content="$(echo 'file content' | base64)" \
  -f branch="main"

# Update existing file (requires SHA)
SHA=$(gh api /repos/{owner}/{repo}/contents/{path} | jq -r '.sha')
gh api -X PUT /repos/{owner}/{repo}/contents/{path} \
  -f message="Update file" \
  -f content="$(echo 'new content' | base64)" \
  -f sha="$SHA" \
  -f branch="main"
```

### Push Multiple Files

Use git commands for pushing multiple files:

```bash
# Stage and commit multiple files
git add file1.txt file2.txt
git commit -m "Add multiple files"
git push origin branch-name

# Or use a single commit for all changes
git add .
git commit -m "Update files"
git push
```

### Create Branch

```bash
# Via git (local)
git checkout -b new-branch
git push -u origin new-branch

# Via API (remote, from default branch)
SHA=$(gh api /repos/{owner}/{repo}/git/refs/heads/main | jq -r '.object.sha')
gh api -X POST /repos/{owner}/{repo}/git/refs \
  -f ref="refs/heads/new-branch" \
  -f sha="$SHA"

# From specific branch
SHA=$(gh api /repos/{owner}/{repo}/git/refs/heads/source-branch | jq -r '.object.sha')
gh api -X POST /repos/{owner}/{repo}/git/refs \
  -f ref="refs/heads/new-branch" \
  -f sha="$SHA"
```

### List Commits

```bash
# List commits via CLI
git log --oneline -20

# List commits via API
gh api /repos/{owner}/{repo}/commits

# With filters
gh api "/repos/{owner}/{repo}/commits?sha=branch&per_page=10"
gh api "/repos/{owner}/{repo}/commits?author=username"
gh api "/repos/{owner}/{repo}/commits?since=2024-01-01T00:00:00Z"

# JSON output
gh api /repos/{owner}/{repo}/commits --jq '.[].commit.message'
```

---

## Issue Operations

### List Issues

```bash
# List open issues
gh issue list

# With filters
gh issue list --state open
gh issue list --state closed
gh issue list --state all
gh issue list --assignee @me
gh issue list --assignee username
gh issue list --author @me
gh issue list --label bug
gh issue list --label "bug,priority:high"
gh issue list --milestone "v1.0"

# Search with query
gh issue list --search "is:open label:bug"

# JSON output
gh issue list --json number,title,state,labels
```

### Get Issue Details

```bash
# View issue
gh issue view 123

# View in web browser
gh issue view 123 --web

# JSON output
gh issue view 123 --json number,title,body,state,labels,assignees,comments

# Get comments
gh issue view 123 --comments
```

### Create Issue

```bash
# Interactive
gh issue create

# With options
gh issue create --title "Bug report" --body "Description"
gh issue create --title "Feature" --label enhancement --assignee @me
gh issue create --title "Bug" --milestone "v1.0" --project "Board"

# From file
gh issue create --title "Issue" --body-file issue-body.md

# Open in editor
gh issue create --title "Issue" --editor
```

### Update Issue

```bash
# Edit title
gh issue edit 123 --title "New title"

# Edit body
gh issue edit 123 --body "New description"
gh issue edit 123 --body-file updated.md

# Modify labels
gh issue edit 123 --add-label "priority:high"
gh issue edit 123 --remove-label "needs-triage"

# Modify assignees
gh issue edit 123 --add-assignee username
gh issue edit 123 --remove-assignee username

# Change milestone
gh issue edit 123 --milestone "v2.0"

# Close/reopen
gh issue close 123
gh issue reopen 123
```

### Add Issue Comment

```bash
# Add comment
gh issue comment 123 --body "This is a comment"

# From file
gh issue comment 123 --body-file comment.md

# Open in editor
gh issue comment 123 --editor

# Edit last comment
gh issue comment 123 --edit-last --body "Updated comment"
```

### Search Issues

```bash
# Basic search
gh search issues "memory leak"

# With filters
gh search issues "bug" --repo owner/repo
gh search issues "type:bug" --state open
gh search issues "label:critical" --assignee username
gh search issues "is:pr is:merged" --author username

# JSON output
gh search issues "query" --json number,title,repository,state
```

---

## Pull Request Operations

### List Pull Requests

```bash
# List open PRs
gh pr list

# With filters
gh pr list --state open
gh pr list --state closed
gh pr list --state merged
gh pr list --state all
gh pr list --author @me
gh pr list --assignee username
gh pr list --label "needs-review"
gh pr list --base main
gh pr list --head feature-branch

# Search with query
gh pr list --search "is:open review:required"

# JSON output
gh pr list --json number,title,state,author,labels
```

### Get Pull Request Details

```bash
# View PR
gh pr view 123

# View in web
gh pr view 123 --web

# JSON output
gh pr view 123 --json number,title,body,state,author,labels,reviews,commits,files

# View comments
gh pr view 123 --comments
```

### Create Pull Request

```bash
# Interactive
gh pr create

# With options
gh pr create --title "Fix bug" --body "Description"
gh pr create --title "Feature" --base main --head feature-branch
gh pr create --fill  # Use commit info
gh pr create --draft  # Create as draft

# With reviewers
gh pr create --title "PR" --reviewer user1,user2
gh pr create --title "PR" --reviewer team:my-team

# With labels and assignees
gh pr create --title "PR" --label bug --assignee @me

# Open in web to finish
gh pr create --web
```

### Get Pull Request Files

```bash
# View diff
gh pr diff 123

# Via API (detailed file info)
gh api /repos/{owner}/{repo}/pulls/123/files

# JSON with additions/deletions
gh api /repos/{owner}/{repo}/pulls/123/files --jq '.[] | {filename, status, additions, deletions}'
```

### Get Pull Request Status/Checks

```bash
# View checks
gh pr checks 123

# Watch checks in real-time
gh pr checks 123 --watch

# Wait for checks to complete
gh pr checks 123 --watch --fail-level all

# JSON output
gh pr checks 123 --json name,state,conclusion
```

### Create Pull Request Review

```bash
# Approve
gh pr review 123 --approve

# Request changes
gh pr review 123 --request-changes --body "Please fix the tests"

# Comment only
gh pr review 123 --comment --body "Looks good so far"

# Add inline comments via API
gh api -X POST /repos/{owner}/{repo}/pulls/123/reviews \
  -f body="Review comment" \
  -f event="COMMENT" \
  -f comments='[{"path":"file.js","position":10,"body":"Consider refactoring"}]'
```

### Get Pull Request Reviews

```bash
# Via API
gh api /repos/{owner}/{repo}/pulls/123/reviews

# Get review details
gh api /repos/{owner}/{repo}/pulls/123/reviews --jq '.[] | {user: .user.login, state: .state, body: .body}'
```

### Get Pull Request Comments

```bash
# Review comments (inline)
gh api /repos/{owner}/{repo}/pulls/123/comments

# Issue comments (general)
gh api /repos/{owner}/{repo}/issues/123/comments

# All comments with details
gh api /repos/{owner}/{repo}/pulls/123/comments --jq '.[] | {user: .user.login, body: .body, path: .path}'
```

### Merge Pull Request

```bash
# Merge (default method)
gh pr merge 123

# Squash merge
gh pr merge 123 --squash

# Rebase merge
gh pr merge 123 --rebase

# Delete branch after merge
gh pr merge 123 --delete-branch

# Auto-merge when checks pass
gh pr merge 123 --auto --squash

# With custom commit message
gh pr merge 123 --squash --subject "feat: Add feature" --body "Detailed description"
```

### Update Pull Request Branch

```bash
# Via API
gh api -X PUT /repos/{owner}/{repo}/pulls/123/update-branch \
  -f expected_head_sha="current-head-sha"

# Or use git locally
gh pr checkout 123
git merge main
git push
```

---

## Code Search

### Search Code

```bash
# Basic search
gh search code "function authenticate"

# In specific repo
gh search code "TODO" --repo owner/repo

# With language filter
gh search code "interface User" --language typescript

# With path filter
gh search code "config" --filename "*.yaml"

# JSON output
gh search code "query" --json path,repository,textMatches
```

### Search Users

```bash
# Via API
gh api "/search/users?q=fullname:John+type:user"

# With filters
gh api "/search/users?q=location:Seattle+followers:>100"

# Search by email domain
gh api "/search/users?q=email:@company.com"
```

---

## GitHub Actions

### List Workflows

```bash
gh workflow list
gh workflow list --all  # Include disabled
```

### View Workflow Runs

```bash
# List runs
gh run list
gh run list --workflow "CI"
gh run list --branch main
gh run list --status failure

# View specific run
gh run view 12345
gh run view 12345 --log
gh run view 12345 --log-failed

# Watch run in real-time
gh run watch 12345
```

### Trigger Workflow

```bash
# Trigger workflow_dispatch
gh workflow run "Deploy" --ref main

# With inputs
gh workflow run "Deploy" -f environment=production -f version=1.0.0
```

### Cancel/Rerun Workflow

```bash
# Cancel
gh run cancel 12345

# Rerun
gh run rerun 12345
gh run rerun 12345 --failed  # Only failed jobs
```

---

## Releases

### List Releases

```bash
gh release list
gh release list --limit 10
```

### View Release

```bash
gh release view v1.0.0
gh release view latest
```

### Create Release

```bash
# Create release
gh release create v1.0.0

# With options
gh release create v1.0.0 --title "Version 1.0.0" --notes "Release notes"
gh release create v1.0.0 --generate-notes
gh release create v1.0.0 --draft
gh release create v1.0.0 --prerelease

# Upload assets
gh release create v1.0.0 ./dist/*.tar.gz
```

---

## Authentication & Configuration

### Authentication

```bash
# Login (interactive)
gh auth login

# With clipboard (OAuth code auto-copied)
gh auth login --clipboard

# Check status
gh auth status

# Switch accounts
gh auth switch

# Logout
gh auth logout
```

### Configuration

```bash
# Set editor
gh config set editor "code --wait"
gh config set editor vim

# Create aliases
gh alias set prs 'pr list --author @me'
gh alias set co 'pr checkout'
gh alias set issues 'issue list --assignee @me'

# List aliases
gh alias list
```

### Browse (Terminal to Web)

```bash
# Open repo in browser
gh browse

# Open specific PR
gh browse 123

# Open issues page
gh browse -- issues

# Open settings
gh browse -- settings

# Open file
gh browse -- src/main.ts
```

---

## Advanced API Usage

For any operation not covered by `gh` commands:

```bash
# GET request
gh api /repos/{owner}/{repo}/issues

# POST request
gh api -X POST /repos/{owner}/{repo}/issues \
  -f title="New issue" \
  -f body="Description"

# PUT request
gh api -X PUT /repos/{owner}/{repo}/issues/123 \
  -f state="closed"

# DELETE request
gh api -X DELETE /repos/{owner}/{repo}/issues/comments/456

# With pagination
gh api /repos/{owner}/{repo}/issues --paginate

# JSON parsing with jq
gh api /repos/{owner}/{repo}/issues --jq '.[].title'

# GraphQL queries
gh api graphql -f query='
  query {
    repository(owner: "owner", name: "repo") {
      issues(first: 10) {
        nodes { title number }
      }
    }
  }
'
```

---

## Common Workflows

### Complete PR Workflow

```bash
# Create branch and make changes
git checkout -b feature/new-thing
# ... make changes ...
git add . && git commit -m "Add new feature"
git push -u origin feature/new-thing

# Create PR
gh pr create --fill

# Check status and merge
gh pr checks --watch
gh pr merge --squash --delete-branch
```

### Daily PR Review Routine

```bash
# PRs waiting for your review
gh pr list --search "review-requested:@me"

# Your open PRs
gh pr list --author @me

# Check PR status
gh pr checks --watch
```

### Release Workflow

```bash
# Create and push tag
git tag v1.0.0
git push origin v1.0.0

# Create release with auto-generated notes
gh release create v1.0.0 --generate-notes

# Upload release assets
gh release upload v1.0.0 ./dist/*.tar.gz
```

---

## When to Ask for Help

Ask the user for clarification when:

- Repository owner/name is ambiguous
- Multiple PRs or issues match criteria
- Authentication or permissions issues arise
- Workflow involves destructive operations (force push, delete)
- Need to determine correct branch or ref
