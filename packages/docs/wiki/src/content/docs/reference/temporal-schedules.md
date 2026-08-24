---
title: Temporal schedule mechanics
description: How the ~30 cron schedules are defined, reconciled, paused, deleted, and caught up after an outage.
sidebar:
  order: 2
---

All recurring automation is a single `SCHEDULES` array in
[`schedule-definitions.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions.ts).
Every worker boot upserts the whole fleet — currently about 30 schedules.

[`register-schedules.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/register-schedules.ts)
owns reconciliation and the explicit `DELETED_SCHEDULE_IDS` allowlist.

For the list of what runs and when, see
[Temporal workflow inventory](/reference/temporal-workflows/).

## Schedule properties

| Property        | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| Timezone        | `America/Los_Angeles`, wall-clock                                   |
| Overlap policy  | `SKIP` by default; the weekly Scout parlay uses `ALLOW_ALL`         |
| Reconciliation  | upsert of every schedule at each worker boot                        |
| Source of truth | the `SCHEDULES` array in code; a PR is the change process           |
| Deletion        | explicit — add the schedule ID to the deletion list                 |
| Orphan drift    | a metric is exported for any server schedule code no longer defines |

## Pause behaviour

| Situation                             | Result                                                 |
| ------------------------------------- | ------------------------------------------------------ |
| Paused in the Temporal UI             | preserved across restarts and reconciliation           |
| Required environment variable missing | auto-paused at boot, with a note                       |
| Removed from `SCHEDULES`              | remains on the server until added to the deletion list |

`scout-weekly-parlay` also starts with a source-defined initial pause note. It
must remain paused until the private-beta Discord fixture cycle is approved;
after that, the Temporal UI's durable pause state is the operational suspension
control. Its weekly executions may overlap: each execution owns a distinct
period key, and a delayed prior finalization must not suppress the next market.

## Catchup windows

| Schedule class              | Catchup window |
| --------------------------- | -------------- |
| Most schedules              | 1 hour         |
| Time-of-day home automation | 5 minutes      |

Home automation is deliberately tight: a 09:00 vacuum run should not fire at
noon after an outage.

## Automation classes

| Class                   | Touches                   | Review boundary         |
| ----------------------- | ------------------------- | ----------------------- |
| Repo-artifact jobs      | a committed artifact      | a PR                    |
| Live-maintenance jobs   | running systems, in place | none — trusted directly |
| Report-only agent tasks | nothing; emails findings  | none — cannot write     |

Repo-artifact jobs open a PR on drift under a GitHub App token. Most await
review; the additive-only lanes (Scout's Data Dragon refresh, queue-windows)
use `gh pr merge --auto` and land on green checks.

One repo-artifact job is not deterministic: `scout-season-refresh` runs the
Claude Agent SDK to derive season changes.

The four Buildkite and Kometa maintenance activities run on the serial
`maintenance` task queue in one persistent worker; they do not create Kubernetes
Jobs.

## Related

- [How to pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
- [Why Temporal](/explanation/temporal/overview/)
