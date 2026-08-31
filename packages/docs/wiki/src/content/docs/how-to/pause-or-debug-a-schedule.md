---
title: Pause or debug a schedule
description: Stop a recurring workflow, work out why one failed or never fired, and remove it for good.
sidebar:
  order: 5
---

Work down this list in order. Each step rules out a class of cause.

The Temporal Web UI is tailnet-gated and lives in the `temporal` namespace.

## 1. Pause it, if that is all you need

Pause the schedule in the Temporal UI. Pause state is runtime state: it is
preserved across worker restarts and across reconciliation, so a boot will not
silently resume it.

This is the right move for a noisy or misbehaving job. It is not how you remove
one — see the last section.

## 2. Confirm the run actually failed

Find the execution in the UI. `temporal-failure-watch` sends one Alerts
occurrence for any execution that failed or timed out in the last 24 hours, so
an occurrence usually means there is a real execution to read.

The UI summary names the workflow's purpose. Its details show only bounded
operational metadata: environment, domain, trigger, release commit, and current
phase. They never contain Activity arguments, prompts, report bodies, player
data, credentials, or task tokens. Treat a UI field containing any of those as
a data-handling defect.

Use the native CLI when you need an exact state or history. Start with bounded
descriptions and open a full history only for the one execution under
investigation:

```bash
toolkit temporal workflow list \
  --query "ExecutionStatus='Running' AND Environment='beta'"
toolkit temporal workflow list \
  --query "ExecutionStatus='Failed' AND Domain='scout'"
toolkit temporal workflow describe --workflow-id <WORKFLOW_ID>
toolkit temporal workflow show --workflow-id <WORKFLOW_ID>
```

Do not paste or print a history during routine diagnosis. Histories can contain
payloads even though the enriched UI fields and logs do not.

## 3. Follow one execution through traces and logs

When call-graph tracing is enabled for the deployed Worker, look for one trace
containing the client or Schedule start, Workflow, child or Continue-As-New
edge, Activity, and nested `gen_ai.*` spans:

```bash
toolkit tempo query \
  '{ resource.deployment.environment.name = "beta" && resource.temporal.domain = "scout" }' \
  --since 1h --limit 20
```

Use the trace ID from that result to retrieve correlated structured logs:

```bash
toolkit loki query \
  '{service_name=~"temporal-worker|scout-backend"} | trace_id="<TRACE_ID>"' \
  --since 1h --limit 50
```

The Temporal dashboard exposes the same environment/domain filters and links
between Temporal UI, Tempo, and Loki. An absent client-to-Activity edge means
the instrumentation or propagation path is incomplete; an absent log link
means the logger ran outside the active span or OTLP delivery failed.

## 4. Classify a timeout

`temporal-failure-watch` fetches the failed execution's history and classifies
the timeout as workflow-task, activity, execution, or unknown.

A **workflow-task timeout before any activity ran** is reported as worker or
task-queue availability — the workflow never got picked up. That is an
infrastructure problem, not a bug in the workflow.

SDK metrics alert after five minutes on missing agent-task workflow pollers,
high schedule-to-start latency, or worker scrape loss.

## 5. Check it was not auto-paused

A schedule whose required environment variables are missing is auto-paused at
boot with a note. This looks identical to "it never ran" until you read the
schedule.

## 6. Check the catchup window

After a server outage, most schedules replay up to an hour. Time-of-day home
automation gets five minutes only, deliberately — a 09:00 vacuum run should not
fire at noon.

A missed run outside the window is gone and will not replay.

## 7. Check for overlap

Overlap policy is normally `SKIP`. A slow run does not stack a second one; the
next tick is skipped instead. A job that appears to have "missed" a run may have
still been executing. The `scout-weekly-parlay` exception uses `ALLOW_ALL`
because each execution owns a distinct period and delayed finalization must not
suppress the next Sunday's market.

## Change or remove a schedule

Schedules live in the `SCHEDULES` array in
[`src/schedules/schedule-definitions.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions.ts)
and are upserted on every worker boot. The code is the inventory and a PR is the
change process.

Deleting the definition is not enough. Removing a workflow means **adding its
schedule ID to `DELETED_SCHEDULE_IDS` in
[`register-schedules.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/register-schedules.ts)**,
which boot then acts on. Until you do, the schedule keeps running on the server.

An orphan detector exports a metric for any server-side schedule that code no
longer defines, so this drift alerts rather than lingering quietly.

## Related

- [Temporal schedule mechanics](/reference/temporal-schedules/)
- [Temporal workflow inventory](/reference/temporal-workflows/)
