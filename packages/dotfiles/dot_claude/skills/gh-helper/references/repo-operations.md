# Repository Operations

## Search Repositories

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

## Create Repository

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

## Fork Repository

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

## Get File Contents

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

## Create or Update File

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

## Push Multiple Files

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

## Create Branch

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

## List Commits

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
