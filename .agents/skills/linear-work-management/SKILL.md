---
name: linear-work-management
description: Read or manage this repository's Linear issues, projects, cycles, plans, triage, and follow-up work through toolkit linear. Use when work must be found, recorded, updated, or linked to a branch.
---

# Linear work management

Linear owns plans, TODOs, review queues, and unfinished follow-ups. Repository
documents must not become a parallel work-tracking system.

Start by checking the ambient identity and resolving existing work:

```bash
toolkit linear --version
toolkit linear auth whoami
toolkit linear issue id
toolkit linear issue view SJ-123
toolkit linear issue list --team <key>
```

The configured workspace is `sjerred` (`monorepo`). Search before creating an
issue. Read the issue, comments, relationships, project, and cycle before
editing it.

For mutations, inspect the command or API schema, name the exact target, and
change only fields required by the task. Keep issue state synchronized with
observable work; do not mark complete merely because code exists locally.

Never print or paste the Linear token, use interactive login as the normal
path, or copy private issue content into a public wiki. Link the issue in branch
and PR metadata through the repository's Git-Spice workflow.
