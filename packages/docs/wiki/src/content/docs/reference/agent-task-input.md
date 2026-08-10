---
title: Agent task input
description: The scheduled-agent task schema, its three submission surfaces, provider settings, and conflict rules.
sidebar:
  order: 3
---

An agent task is a scheduled LLM run that inspects state and emails a Markdown
report. This page describes its input contract.

Schema and dispatcher:
[`agent-task.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/shared/agent-task.ts),
[`agent-task-scheduler.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/lib/agent-task-scheduler.ts).

## Task fields

| Field             | Required | Value                                                                |
| ----------------- | -------- | -------------------------------------------------------------------- |
| `title`           | yes      | human label; also part of the workflow ID                            |
| `provider`        | yes      | `claude` or `codex`                                                  |
| `mode`            | no       | defaults to `report-only`; that is the only accepted value           |
| `prompt`          | yes      | the task instruction                                                 |
| `repo`            | yes      | `{ fullName, ref }`                                                  |
| `runAt`           | no       | ISO timestamp for a deferred one-off run                             |
| `cron`            | no       | cron expression for a recurring run                                  |
| `scheduleId`      | no       | recurring schedule ID; generated from task content when omitted      |
| `source`          | no       | `{ docPath }` — the document that motivated the task                 |
| `allowSelfCancel` | no       | defaults to `false`; permits the task to pause its own recurring run |

Set at most one of `runAt` and `cron`. Omitting both starts a one-off workflow
immediately. Cron expressions are evaluated in `America/Los_Angeles`.

## Doc block form

```md
<!-- temporal-agent-task
{
  "title": "Recheck Birmel post-deploy metrics",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-31T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/guides/2026-04-25_birmel-remediation-followups.md"
  },
  "prompt": "Pull the metrics from the Post-deploy verification section. Email whether each check is green or still red, with links/evidence."
}
-->
```

## Submission surfaces

| Surface      | Entry point                                                       | Auth                                          |
| ------------ | ----------------------------------------------------------------- | --------------------------------------------- |
| Doc block    | `<!-- temporal-agent-task { … } -->` in any `packages/docs/` file | none — operator runs the CLI                  |
| Operator CLI | `bun run scripts/schedule-agent-task.ts --from-doc <path>`        | port-forwarded Temporal                       |
| HTTP API     | `POST /agent-tasks` on `temporal-agent-tasks.sjer.red`            | `Authorization: Bearer $AGENT_TASK_API_TOKEN` |

One document may contain multiple task blocks. The CLI validates all blocks
before connecting and schedules them in document order. It also accepts
`--json` and `--stdin` for a single task. The HTTP API is the only public
scheduling ingress; the Temporal server itself is never exposed.

## Conflict rules

The one-off workflow ID is the task title plus a content hash of the normalized
input, submitted with `ALLOW_DUPLICATE_FAILED_ONLY` and conflict policy `FAIL`.

| Prior state of that task ID | Resubmitting              |
| --------------------------- | ------------------------- |
| Active                      | rejected; API returns 500 |
| Already succeeded           | rejected; API returns 500 |
| Failed                      | starts a fresh run        |
| Timed out                   | starts a fresh run        |

Future-dated tasks defer via Temporal's `startDelay`, so the wait does not
consume the run's execution timeout.

## Limits

| Limit              | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| Subprocess runtime | 90 minutes maximum, must heartbeat                                       |
| Follow-up tasks    | one per run                                                              |
| Self-cancellation  | may pause its own cron, never delete it, and only with `allowSelfCancel` |
| Output             | one emailed Markdown report, via Postal                                  |

## Provider settings

|                | Claude                                          | Codex                          |
| -------------- | ----------------------------------------------- | ------------------------------ |
| Command        | `claude -p`                                     | `codex exec`                   |
| Model          | claude-opus-5                                   | —                              |
| Schema         | `--json-schema`, inline draft-07 plain-optional | its own dialect                |
| Tools          | `Bash, Read, Grep, Glob, WebFetch`              | `--sandbox danger-full-access` |
| Pinned version | Claude Code `2.1.220`                           | —                              |

Claude's output contract accepts only the CLI result message's
`structured_output` field, validated with Zod. A successful process without that
field is a failure; prose and fenced JSON are not fallback formats.

## Environment exposure

The subprocess inherits the **full worker environment**.

| Credential                                              | State in the subprocess                                    |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| GitHub installation token                               | present as `GH_TOKEN`                                      |
| Raw GitHub App key                                      | stripped                                                   |
| Anthropic API key                                       | dropped for Claude runs, so the run bills the subscription |
| Grafana, PagerDuty, ArgoCD, Bugsink, Cloudflare, Postal | readable                                                   |
| Mounted service-account token                           | readable                                                   |

This is deliberate — the daily homelab audit needs those credentials for its
live read-only checks. See
[the agent task boundary](/explanation/temporal/agent-task-boundary/) for what
that means.

## Related

- [How to schedule an agent task](/how-to/schedule-an-agent-task/)
- [How to run the production canary](/how-to/run-the-agent-task-canary/)
- [Why agent tasks are report-only by policy](/explanation/temporal/agent-task-boundary/)
