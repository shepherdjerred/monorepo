# Code Search, GitHub Actions, Releases, Authentication & Advanced API

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
