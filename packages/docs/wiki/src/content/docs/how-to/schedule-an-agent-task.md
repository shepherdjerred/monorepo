---
title: Schedule an agent task
description: Put a follow-up check next to the document that motivated it, then dispatch it to Temporal.
sidebar:
  order: 3
---

An agent task is a scheduled Claude or Codex run that inspects current state and
emails you a report. Use one when a document needs checking later and you do not
want to remember to check it.

Anything that must _change_ the repo is a deterministic workflow instead, not an
agent task.

## 1. Write the task block

Put the block in the document that motivated the follow-up, so the task and its
context stay together.

```md
<!-- temporal-agent-task
{
  "contractVersion": 2,
  "title": "Recheck Birmel post-deploy metrics",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-31T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "checks": [
    { "id": "post-deploy-metrics", "label": "Post-deploy metrics", "required": true, "evidenceRequirement": "Every current Birmel target reports up=1.", "evidenceCollectors": [{ "id": "birmel-up", "kind": "prometheus", "query": "up{namespace=\"birmel\"}", "expectation": { "kind": "numeric", "operator": "eq", "threshold": 1, "quantifier": "all" } }] }
  ],
  "source": {
    "docPath": "packages/docs/guides/2026-04-25_birmel-remediation-followups.md"
  },
  "prompt": "Pull the metrics from the Post-deploy verification section. Email whether each check is green or still red, with links/evidence."
}
-->
```

For a recurring check, replace `runAt` with `cron` and add a stable
`scheduleId`. Cron is evaluated in `America/Los_Angeles`.

A document may contain multiple blocks when a rollout needs checks at distinct
times. Keep each block next to the checkpoint it describes.

Declare every check separately. Mark it required only when a clean verdict is
impossible without it, and make `evidenceRequirement` explain the current
observation that proves the result. Add one or more `evidenceCollectors` with an
exact command `argv` and output contract, or a typed Prometheus query. Give each
collector an `expectation`: accepted and passing exit codes or typed JSON path
assertions for commands, and a numeric comparison plus `all` or `any` for
Prometheus. The worker runs the collector and evaluates the expectation after
provider investigation. The final result must cite each deterministic collector
receipt; provider-authored commands and prose cannot substitute for one. If the
model reports a pass but a predicate fails, the worker changes that check to
failed.

## 2. Dispatch it

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 \
  bun run scripts/schedule-agent-task.ts --from-doc ../../packages/docs/<doc>.md
```

The CLI validates every block as contract v2 before connecting, then schedules
them in document order. It also takes `--json` and `--stdin` for a single task.

A `cron` input upserts a Temporal schedule. A `runAt` input starts a one-off
workflow whose ID is a content hash, deferred with `startDelay`.

## 3. Confirm it landed

Check the Temporal Web UI for the schedule or the pending execution. One report
arrives by email for every run, including clear, changed, partial, and failed
outcomes. The subject and status come from the validated report; the model
cannot choose them.

:::caution
Resubmitting is not a silent no-op. An active or already-succeeded task ID is
rejected; a failed or timed-out one starts a fresh run. Change the title or the
input if you genuinely want a second run.
:::

## From an automation instead

`POST /agent-tasks` on `temporal-agent-tasks.sjer.red` with
`Authorization: Bearer $AGENT_TASK_API_TOKEN`. That is the only public
scheduling ingress — the Temporal server itself is never exposed.

Do not build a general-purpose public scheduling path around it.

The HTTP body must also be contract v2 with declared checks. Old v1 payloads
are accepted only when replaying existing Temporal histories.

## Related

- [Agent task input](/reference/agent-task-input/) — every field and limit
- [Run the production canary](/how-to/run-the-agent-task-canary/)
- [Why agent tasks are report-only by policy](/explanation/temporal/agent-task-boundary/)
