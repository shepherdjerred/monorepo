# Issue Operations

## List Issues

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

## Get Issue Details

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

## Create Issue

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

## Update Issue

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

## Add Issue Comment

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

## Search Issues

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
