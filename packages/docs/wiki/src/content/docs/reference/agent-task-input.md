---
title: Agent task input
description: The scheduled-agent task schema, its three submission surfaces, provider settings, and conflict rules.
sidebar:
  order: 3
---

An agent task is a scheduled LLM run that inspects state and emails a validated,
evidence-backed report. New submissions use contract v2. Contract v1 exists
only so existing Temporal histories can replay; those results are always
partial because they did not declare coverage.

Schema and dispatcher:
[`agent-task.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/shared/agent-task.ts),
[`agent-task-scheduler.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/lib/agent-task-scheduler.ts).

## Task fields

| Field                 | Required | Value                                                           |
| --------------------- | -------- | --------------------------------------------------------------- |
| `contractVersion`     | yes      | `2`                                                             |
| `title`               | yes      | human label; also part of the workflow ID                       |
| `provider`            | yes      | `claude` or `codex`                                             |
| `mode`                | no       | defaults to `report-only`; that is the only accepted value      |
| `prompt`              | yes      | investigation instructions                                      |
| `checks`              | yes      | one or more declared check definitions                          |
| `repo`                | yes      | `{ fullName, ref }`                                             |
| `runAt`               | no       | ISO timestamp for a deferred one-off run                        |
| `cron`                | no       | cron expression for a recurring run                             |
| `scheduleId`          | no       | recurring schedule ID; generated from task content when omitted |
| `source`              | no       | `{ docPath, url, note }` provenance                             |
| `model`, `maxTurns`   | no       | provider execution controls                                     |
| `agentTimeoutMinutes` | no       | positive integer, at most 90                                    |

Set at most one of `runAt` and `cron`. Omitting both starts a one-off workflow
immediately. Cron expressions are evaluated in `America/Los_Angeles`.

## Doc block form

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
  "source": { "note": "Birmel post-deploy follow-up in Linear" },
  "prompt": "Pull the metrics from the Post-deploy verification section. Email whether each check is green or still red, with links/evidence."
}
-->
```

## Submission surfaces

| Surface      | Entry point                                                | Auth                                          |
| ------------ | ---------------------------------------------------------- | --------------------------------------------- |
| Doc block    | `<!-- temporal-agent-task { … } -->` in any Markdown file  | none — operator runs the CLI                  |
| Operator CLI | `bun run scripts/schedule-agent-task.ts --from-doc <path>` | port-forwarded Temporal                       |
| HTTP API     | `POST /agent-tasks` on `temporal-agent-tasks.sjer.red`     | `Authorization: Bearer $AGENT_TASK_API_TOKEN` |

One document may contain multiple task blocks. The CLI validates every block as
v2 before connecting and schedules them in document order. It also accepts
`--json` and `--stdin` for a single task. The HTTP API also requires v2 and is
the only public scheduling ingress; the Temporal server itself is never
exposed.

Each check has `id`, `label`, `required`, `evidenceRequirement`, and a non-empty
`evidenceCollectors` array. A collector is either an exact command `argv` with
an output contract (`allow-empty`, `non-empty`, or structured `json`), or a
typed Prometheus query with an optional range window. Every collector requires
an `expectation`. Command expectations either distinguish passing accepted exit
codes or evaluate typed JSON path assertions; a `*` path segment expands arrays
or object values. Prometheus expectations compare finite numeric samples to a
threshold. Both JSON and Prometheus expectations declare whether `all` or `any`
observations must match. The worker executes collectors and evaluates these
predicates independently after the investigation phase with no provider or
delivery credential. It never executes model-authored command text as a
collector.

The final result must report every declared ID once and cite every deterministic
`collector:<check-id>:<collector-id>` receipt for that check. Provider tool
receipts may support findings, but cannot establish check coverage. A missing,
failed, spoofed, or uncited collector makes execution partial and prevents a
clear verdict. A successfully collected adverse observation has
`semanticStatus: failed`; it keeps execution complete but deterministically
overrides a model-authored pass and produces an attention verdict. Replayed
early-v2 inputs without collectors or predicates remain valid histories but are
always partial. V2 follow-ups inherit the parent collectors; the model cannot
replace them.

The model does not return a verdict or subject. The reporter derives them from
validated state: incomplete required coverage is inconclusive; failed checks or
warning/critical findings need attention; informational findings mean changed;
optional skipped checks mean pending; only fully passed coverage with no
findings is clear.

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

| Limit              | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| Subprocess runtime | 90 minutes maximum, must heartbeat                      |
| Follow-up tasks    | one report-only follow-up per run                       |
| Schedule changes   | agents cannot pause, cancel, or delete schedules        |
| Synthesis          | optional, evidence-backed, 80 words maximum             |
| Output             | one shared-format heartbeat per run, including failures |

## Provider settings

|                | Claude                                          | Codex                          |
| -------------- | ----------------------------------------------- | ------------------------------ |
| Command        | `claude -p`                                     | `codex exec`                   |
| Model          | claude-opus-5                                   | —                              |
| Schema         | `--json-schema`, inline draft-07 plain-optional | its own dialect                |
| Tools          | `Bash, Read, Grep, Glob, WebFetch`              | `--sandbox danger-full-access` |
| Pinned version | Claude Code `2.1.220`                           | —                              |

Claude's output contract accepts only the CLI result message's
`structured_output` field; Codex uses its strict output-schema file. Both are
validated with Zod. A successful process without valid structured output is a
failure; prose and fenced JSON are not fallback formats. Provider adapters
extract redacted evidence receipts from actual tool or command events before
running a separate finalization pass over that explicit receipt catalog. Claude
tools are disabled during finalization; any new provider events are not accepted
as report evidence.

## Environment exposure

The subprocess receives an allowlisted environment rather than inheriting the
worker environment.

| Input                                       | State in the subprocess                                     |
| ------------------------------------------- | ----------------------------------------------------------- |
| Selected provider credential                | absent; replaced by an ephemeral loopback-broker credential |
| Other provider credentials                  | absent                                                      |
| Public GitHub repository credential         | absent; the throwaway clone is unauthenticated              |
| `HOME`                                      | the throwaway workdir, not the worker image home            |
| Prometheus and alert-dashboard URLs         | present without API credentials                             |
| Kubernetes service address and mounted SA   | present; the dedicated identity has read-only audit RBAC    |
| Postal, S3, GitHub App, and ingress secrets | absent; delivery executes on the core worker queue          |
| ArgoCD, Grafana, Buildkite, HA, Cloudflare  | absent                                                      |

The parent worker keeps the selected provider credential and starts a fresh
loopback broker for each run. That broker authenticates the ephemeral client
credential, accepts only the fixed Claude or Codex inference paths, and forwards
to a fixed provider origin with the real credential. A provider subprocess can
still spend its selected provider quota, but it cannot read or transmit the
long-lived credential itself.

This lets generic investigations query the public repository, read-only
Kubernetes API, Prometheus, and alert ledger without crossing the delivery or
operational-credential boundaries. See
[the agent task boundary](/explanation/temporal/agent-task-boundary/) for what
that means.

## Related

- [How to schedule an agent task](/how-to/schedule-an-agent-task/)
- [How to run the production canary](/how-to/run-the-agent-task-canary/)
- [Why agent tasks are report-only by policy](/explanation/temporal/agent-task-boundary/)
