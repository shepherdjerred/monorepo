---
name: pr-health
description: Check PR health status (conflicts, CI, approval) and get actionable next steps
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# PR Health Skill

Check the health of a pull request including merge conflicts, CI status, and approval status.

## Commands

### Check PR Health

```bash
# Check PR for current branch
toolkit pr health

# Check specific PR
toolkit pr health 123

# Output as JSON
toolkit pr health --json

# Specify repository
toolkit pr health --repo owner/repo
```

### Get Workflow Logs

```bash
# Get all logs for a run
toolkit pr logs <run-id>

# Get only failed job logs
toolkit pr logs <run-id> --failed-only

# Get logs for specific job
toolkit pr logs <run-id> --job "build"
```

### Detect PR

```bash
# Find PR for current branch
toolkit pr detect

# Output as JSON
toolkit pr detect --json
```

## Output Format

The health command outputs a structured report:

```
## PR Health Report: #123

**URL:** https://github.com/owner/repo/pull/123

### Status: UNHEALTHY (2 issues)

### Merge Conflicts: UNHEALTHY
- Branch has merge conflicts with base
- Conflicting file: src/lib/parser.ts

To investigate:
\`\`\`bash
git fetch origin main && git merge origin/main
\`\`\`

### CI Status: FAILED
- Job "test" - FAILED
- Run ID: 12345678

To investigate:
\`\`\`bash
toolkit pr logs 12345678 --failed-only
\`\`\`

### Approval: APPROVED
- claude-code-review[bot]: APPROVED

### Next Steps
1. Resolve merge conflicts
2. Fix CI failures
```

## Status Values

- **HEALTHY**: No issues
- **UNHEALTHY**: Issues need to be addressed
- **PENDING**: Waiting for something (CI running, reviews needed)

## Troubleshooting

### "No PR found for current branch"

Create a PR first or specify a PR number:

```bash
gh pr create
# or
toolkit pr health 123
```

### CI logs are empty

The workflow run may not have generated logs yet. Wait for the run to complete.

### Merge conflict detection is inaccurate

Ensure you have fetched the latest from origin:

```bash
git fetch origin main
```
