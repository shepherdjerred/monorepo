# Pull Request Operations

## List Pull Requests

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

## Get Pull Request Details

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

## Create Pull Request

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

## Get Pull Request Files

```bash
# View diff
gh pr diff 123

# Via API (detailed file info)
gh api /repos/{owner}/{repo}/pulls/123/files

# JSON with additions/deletions
gh api /repos/{owner}/{repo}/pulls/123/files --jq '.[] | {filename, status, additions, deletions}'
```

## Get Pull Request Status/Checks

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

## Create Pull Request Review

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

## Get Pull Request Reviews

```bash
# Via API
gh api /repos/{owner}/{repo}/pulls/123/reviews

# Get review details
gh api /repos/{owner}/{repo}/pulls/123/reviews --jq '.[] | {user: .user.login, state: .state, body: .body}'
```

## Get Pull Request Comments

```bash
# Review comments (inline)
gh api /repos/{owner}/{repo}/pulls/123/comments

# Issue comments (general)
gh api /repos/{owner}/{repo}/issues/123/comments

# All comments with details
gh api /repos/{owner}/{repo}/pulls/123/comments --jq '.[] | {user: .user.login, body: .body, path: .path}'
```

## Merge Pull Request

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

## Update Pull Request Branch

```bash
# Via API
gh api -X PUT /repos/{owner}/{repo}/pulls/123/update-branch \
  -f expected_head_sha="current-head-sha"

# Or use git locally
gh pr checkout 123
git merge main
git push
```
