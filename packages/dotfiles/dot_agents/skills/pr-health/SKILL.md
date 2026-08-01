---
name: pr-health
description: Check PR health status (conflicts, CI, approval) and get actionable next steps
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# PR Health Skill

> **This skill reports health; it does not choose or replace the stack owner.**
> New monorepo work uses `gh-stack`. Existing git-spice work stays on
> `git-spice-helper`. Load the owning skill before creating, updating, rebasing,
> syncing, or merging the PR, and never mix the tools.

Check the health of a pull request including merge conflicts, CI status, and approval status.

> **Note:** this monorepo's CI runs on Buildkite (`buildkite/monorepo/pr` + `ci/merge-conflict`) per PR in the stack — the CI section reports those checks. `toolkit pr logs` targets GitHub Actions run IDs, so use Buildkite tooling (`bk build view`) or the Buildkite web UI for logs on this repo; the `toolkit pr logs` commands below still apply to other repos.

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
- Native stack: load `gh-stack`, then run `gh stack sync`.
- Existing git-spice stack: load `git-spice-helper` and use its restack flow.
- Generic unstacked repository: fetch and merge/rebase the PR's base.

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
gh stack submit --auto # new monorepo work
# Existing git-spice work: use git-spice branch/stack submit.
# Plain gh pr create is only for stateless bots, forks, or other repositories.
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
