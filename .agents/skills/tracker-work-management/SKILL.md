---
name: tracker-work-management
description: Read or manage this repository's Tracker issues, projects, triage, and follow-up work through toolkit tracker, including developer-experience friction reports. Use when work must be found, recorded, updated, linked to a branch, or when broken tooling must be filed.
---

# Tracker work management

Tracker owns plans, TODOs, review queues, and unfinished follow-ups. Repository
documents must not become a parallel work-tracking system.

Start by inspecting identity and existing work:

```bash
toolkit tracker whoami --json
toolkit tracker issue view AI-123 --json
toolkit tracker issue list --team AI --limit all --json
```

Search the `AI` team before creating an issue. Create every agent-generated
issue in `AI`; assign a project only when the task names one or the issue is a
developer-experience report. `SJ` is reserved for human-created work. An agent
may update an existing `SJ` issue only when the task explicitly identifies it.
Read the issue, comments, relationships, and project before editing it.

For mutations, inspect `toolkit tracker --help` or the API schema, name the
exact target, and change only fields required by the task. Keep issue state
synchronized with observable work. Do not mark complete merely because code
exists locally. Use `--expected-revision` when editing an inspected issue.

Tracker is private to the tailnet and requires no issue-service credential.
The toolkit supplies the native session actor and model metadata; inspect
`whoami` rather than inventing an identity. A runner supplies its stable actor
explicitly. Link issues in branch and PR metadata through Git-Spice, and never
copy private issue content into public documentation.

## Developer experience reports

Report systemic tooling failures, broken documented commands, missing access or
fixtures, and repeated manual work. Fix small in-scope causes inline; filing a
report must not block or widen the task.

Search first, including closed and archived issues:

```bash
toolkit tracker issue search "<keywords>" --team AI --all-states --include-archived --limit all --json
toolkit tracker issue view <ID> --json
```

Search matches issue titles and descriptions. Inspect comments and relations
on candidate issues to confirm the same cause. On a match, cast one native
vote for the current session with a sanitized note:

```bash
toolkit tracker issue vote <ID> --note "Work: <what this blocked>. Diff: <same as reported, or the observed difference>."
```

Votes are idempotent per issue and actor. Tracker records session, harness and
model metadata automatically; do not add the legacy `+1 hit again` comments.

Create one issue per distinct problem only when no match exists:

```bash
toolkit tracker issue create --team AI --project developer-experience --label Improvement --title "<surface>: <what breaks>" --description-file <path>
```

The body states the symptom, exact command and sanitized output, blocked work,
frequency, suspected owning path, and available session link. Label unproven
causes as suspicion. Do not include tokens or credential-bearing output.
