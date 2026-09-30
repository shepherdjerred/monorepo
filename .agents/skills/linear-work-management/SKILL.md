---
name: linear-work-management
description: Read or manage this repository's Linear issues, projects, cycles, plans, triage, and follow-up work through toolkit linear, including developer-experience friction reports. Use when work must be found, recorded, updated, linked to a branch, or when broken tooling must be filed.
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

The configured workspace is `sjerred` (`monorepo`), which has separate `AI`
and `SJ` teams. Search the `AI` team before creating an issue. Create every
agent-generated issue in `AI`; do not assign a project unless the task names
one or the issue is a developer-experience report. Never create an issue in
`SJ`, which is reserved for human-created work. An agent may update an existing
`SJ` issue only when the task explicitly identifies it. Read the issue,
comments, relationships, project, and cycle before editing it.

For mutations, inspect the command or API schema, name the exact target, and
change only fields required by the task. Keep issue state synchronized with
observable work; do not mark complete merely because code exists locally.

Never print or paste the Linear token, use interactive login as the normal
path, or copy private issue content into a public wiki. Link the issue in branch
and PR metadata through the repository's Git-Spice workflow.

## Developer experience reports

Repository guidance directs systemic developer-experience friction here: broken
tooling, a documented command that does not work, verification you cannot
perform, or manual work you have now repeated. File the issue; do not rewrite
repository guidance to route around the friction.

All agents share one Linear identity, so votes are session-attributed `+1`
comments, not reactions or labels. Search first, upvote a match, and file a new
issue only when there is no match:

```bash
toolkit linear issue query --team AI --search "<keywords>" \
  --search-comments --all-states --include-archived --json
toolkit linear issue view <ID>  # confirm the same root cause, then read comments
```

On a match, check `toolkit linear issue comment list <ID> --json` for your own
session ID first, then post one vote per session:

```bash
toolkit linear issue comment add <ID> --body-file <path>
```

Vote body, first line exactly `+1 hit again`:

```md
+1 hit again

- Session: <shareable session link or ID, else `unknown`>
- Harness: <e.g. claude-code, muse-code, codex, cursor, unknown>
- Model: <model ID as reported by the harness, else `unknown`>
- Work: <one sentence: what task the friction blocked>
- Diff: <`same as reported`, or how your symptom/output differs>
```

Use ambient harness values when exposed; never invent IDs, and keep tokens and
credential-bearing output out of the comment. Issue frequency is 1 (the report)
plus the number of `+1 hit again` comments.

Then file one issue per distinct problem:

```bash
toolkit linear issue create --no-interactive --team AI \
  --project "Developer Experience" --label Improvement \
  --title "<surface>: <what breaks>" --description-file <path>
```

`--no-interactive` is required outside a terminal, and `--description-file` is
the supported path for a markdown body. That body states the symptom, the exact
command and its real output, what the friction blocked and how often, the
suspected owning path in this repository, and the session link. Report unproven
causes as suspicion, and keep tokens and credential-bearing output out of it.
