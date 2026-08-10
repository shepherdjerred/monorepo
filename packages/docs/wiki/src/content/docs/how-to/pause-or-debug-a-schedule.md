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

Find the execution in the UI. `temporal-failure-watch` pages PagerDuty for any
execution that failed or timed out in the last 15 minutes, one alert per run, so
a page usually means there is a real execution to read.

## 3. Classify a timeout

`temporal-failure-watch` fetches the failed execution's history and classifies
the timeout as workflow-task, activity, execution, or unknown.

A **workflow-task timeout before any activity ran** is reported as worker or
task-queue availability — the workflow never got picked up. That is an
infrastructure problem, not a bug in the workflow.

SDK metrics alert after five minutes on missing agent-task workflow pollers,
high schedule-to-start latency, or worker scrape loss.

## 4. Check it was not auto-paused

A schedule whose required environment variables are missing is auto-paused at
boot with a note. This looks identical to "it never ran" until you read the
schedule.

## 5. Check the catchup window

After a server outage, most schedules replay up to an hour. Time-of-day home
automation gets five minutes only, deliberately — a 09:00 vacuum run should not
fire at noon.

A missed run outside the window is gone and will not replay.

## 6. Check for overlap

Overlap policy is `SKIP` everywhere. A slow run does not stack a second one; the
next tick is skipped instead. A job that appears to have "missed" a run may have
still been executing.

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
