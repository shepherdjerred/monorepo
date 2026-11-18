---
name: tracker-work-management
description: Read or manage this repository's Tracker issues, projects, triage, and follow-up work through toolkit tracker, including developer-experience friction and improvement reports. Use when work must be found, recorded, updated, linked to a branch, or when broken tooling, inefficiency, automation candidates, poor architecture, or tech debt should be filed.
---

# Tracker work management

Tracker owns plans, TODOs, review queues, and unfinished follow-ups. Repository
documents must not become a parallel work-tracking system.

Tracker's Forum holds shared coordination and engineering threads (`FM-<N>`
short IDs, accepted everywhere alongside UUIDs), separate from issues. Pull
`toolkit forum list --kind notice --json` at task start and before shared
interventions, and check `toolkit forum inbox --json` when resuming subscribed
threads. Choose the matching kind:

- `notice`: active operational interventions; requires `--condition` and
  supports `--expires-at` plus advisory ownership (`--owner me`, `claim`,
  `handoff --to <KEY|me|none> [--note ...]`).
- `discussion`: open-ended engineering synthesis and discoveries.
- `question`: Q&A threads settled with `toolkit forum accept <FM-N> <REPLY_ID>`.
- `decision`: durable architectural or operational choices (`pin` key ones).

Keep actionable work in Tracker issues: link existing issues with `--issue` /
`forum link <FM-N> <ISSUE>`, or convert a thread or `--reply` into a linked `AI`
issue with `toolkit forum promote <FM-N> [--reply <UUID>]`.

When waiting on an active notice or forum event, block on one SSE stream with
`toolkit forum watch <FM-N> --until-resolved` (or `--once` / `--timeout-sec N`)
rather than polling `forum view` in `sleep` loops. When an old notice is
relevant, inspect its condition and live evidence (`--all` includes expired
notices, since expiration never undoes an intervention); any session may
resolve a verified condition with an evidence note. Notices are advisory and
do not enforce locks.

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

Size and prioritize issues with native triage fields, never legacy `Urgency:*`,
`Impact:*`, or `Effort:*` labels:

```bash
toolkit tracker issue create --team AI --title "<title>" --urgency medium --impact high --effort s --description-file <path>
toolkit tracker issue update AI-123 --urgency low --impact medium --effort m --priority auto --expected-revision 4
toolkit tracker issue list --team AI --effort xs --effort s --urgency high --sort effort --json
```

`--urgency <high|medium|low>`, `--impact <high|medium|low>`, and
`--effort <xs|s|m|l|xl>` accept `none` on `update` and `bulk-update` to clear a
value, and repeat on `list` and `search` (including `none` for untriaged
issues; `--sort` also accepts `urgency`, `impact`, and `effort`). Tracker
computes `priority` automatically from `urgency` and `impact` when `--priority`
is omitted; pass `--priority <1..4>` (or `0` for no priority) only for a
deliberate manual override, and `--priority auto` to return an issue to derived
priority.

Break a larger issue into sub-issues and give work a deadline with:

```bash
toolkit tracker issue create --team AI --title "<step>" --parent AI-123 --due 2026-12-01
toolkit tracker issue update AI-124 --parent AI-123 --due 2026-12-01
toolkit tracker issue update AI-124 --parent none --due none
toolkit tracker issue list --team AI --parent AI-123 --sort due --json
toolkit tracker issue list --team AI --overdue --state started --json
```

A sub-issue shares its parent's team and nests at most five levels. Due dates
are calendar days in `YYYY-MM-DD`. `issue view` shows `parent`, `children` and
`dueDate`.

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
toolkit tracker issue create --team AI --project developer-experience --label Improvement --urgency <high|medium|low> --impact <high|medium|low> --effort <xs|s|m|l|xl> --title "<surface>: <what breaks>" --description-file <path>
```

The body states the symptom, exact command and sanitized output, blocked work,
frequency, suspected owning path, and available session link. Label unproven
causes as suspicion. Do not include tokens or credential-bearing output.

## Improvement reports

File improvements proactively, not only when something blocks you:
inefficient workflows, manual steps that could or should be automated, repeated
friction, poor architecture, and tech debt observed while working. Record the
problem and the evidence; a proposed direction is optional.

Use the same search-first and vote procedure as developer-experience reports.
Create one issue per distinct problem only when no match exists, without a
project unless the task names one:

```bash
toolkit tracker issue create --team AI --label Improvement --urgency <high|medium|low> --impact <high|medium|low> --effort <xs|s|m|l|xl> --title "<area>: <problem>" --description-file <path>
```

The body states what was observed, where (paths, commands, services), how often
or how costly it is, why it matters, and the available session link. Filing
never blocks or widens the task: deliver first, then file, and name every issue
filed or upvoted in the final report.
