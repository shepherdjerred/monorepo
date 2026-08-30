---
title: Temporal workflow inventory
description: Every workflow in the Temporal fleet, with its trigger, decision maker, and output.
sidebar:
  order: 1
---

Every workflow the Temporal worker runs — scheduled, event-driven,
operator-started, or spawned as a child.

**Brain** is what makes the decisions: **deterministic** code, an **LLM** call,
or a native **agent SDK** run with tools.

Cron times are `America/Los_Angeles` wall-clock. Source:
[`src/workflows/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/temporal/src/workflows).

## Task queue routing

| Concern                        | Queue                  | Poller                                   |
| ------------------------------ | ---------------------- | ---------------------------------------- |
| New central Workflow tasks     | `monorepo-workflows`   | credentialless `workflows` role          |
| Pre-cutover Workflow tasks     | original central queue | temporary poller in the `workflows` role |
| Effects                        | owning domain queue    | Activity-only domain role                |
| Pre-cutover default Activities | `default`              | temporary `legacy` role                  |

Schedules, programmatic roots, and child Workflows name
`monorepo-workflows`. Continue-as-new inherits the current Workflow queue.
Every Activity proxy explicitly names one of the domain queues and the source
guard rejects missing queues or effects routed to `monorepo-workflows`.

## Repo upkeep

| Workflow            | Trigger     | Brain                            | Output                                                                      |
| ------------------- | ----------- | -------------------------------- | --------------------------------------------------------------------------- |
| fetcher             | daily 05:00 | deterministic                    | S3 overwrite                                                                |
| deps-summary        | Mon 09:00   | deterministic + optional summary | heartbeat email                                                             |
| llm-catalog-refresh | Mon 09:00   | deterministic                    | PR or [durable alert](/explanation/temporal/workflow-families/#repo-upkeep) |
| homelab-crd-imports | daily 05:30 | deterministic                    | PR                                                                          |
| pokeemerald-data    | daily 04:30 | deterministic                    | PR                                                                          |
| CI I/O impact       | daily 09:00 | deterministic                    | heartbeat email                                                             |
| protobufjs v8 watch | Mon 09:00   | deterministic                    | heartbeat email                                                             |

Ordinary LLM summaries use the shared OpenRouter runtime. The deterministic
`llm-catalog-refresh` sync compares the reviewable repository catalog with
models.dev, LiteLLM, and OpenRouter's text, image, and embedding catalogs. It
fails when a current ordinary-inference route disappears instead of silently
changing model identity.

## Scout

| Workflow                   | Trigger                              | Brain                  | Output                           |
| -------------------------- | ------------------------------------ | ---------------------- | -------------------------------- |
| data-dragon version check  | 06:00 Sun–Fri                        | deterministic          | heartbeat + **auto-merge PR**    |
| data-dragon weekly refresh | Sat 06:00                            | deterministic          | heartbeat + **auto-merge PR**    |
| season-refresh             | Mon 07:00                            | agent research + gates | heartbeat + PR                   |
| showcase-refresh           | Mon 10:00                            | deterministic          | PR                               |
| queue-windows              | daily 06:45                          | deterministic          | heartbeat + gated PR             |
| image-gc                   | daily 04:00                          | deterministic          | S3 deletions                     |
| competition updates        | every minute                         | deterministic          | due Discord standings            |
| weekly parlay lifecycle    | Sun, source-defined Pacific timeline | deterministic          | beta Scout market reconciliation |
| weekly parlay catch-up     | operator, stable period/slot ID      | deterministic          | shortened beta Scout market      |
| realtime and post-match    | fixed Schedules                      | deterministic          | match child Workflows            |
| initial history            | reconciliation                       | deterministic          | paged S3/lake ingestion          |
| report Schedule reconcile  | Signal + every minute                | deterministic          | per-report Schedules             |
| report run                 | report Schedule or manual request    | deterministic          | persisted and Discord output     |
| Explore turn               | one user turn                        | LLM with durable guard | persisted answer and SSE         |
| report-AI edit             | one user edit                        | LLM with durable guard | persisted report revision        |
| queue canary               | operator before/after rollout        | deterministic          | four queue-routing results       |

The weekly parlay workflow uses the Pacific timeline defined by its source
constants and reconciles each period through finalization. Its schedule remains
initially paused until the private-beta Discord fixture cycle is approved; see
the [workflow-family explanation](/explanation/temporal/workflow-families/#weekly-parlay-lifecycle)
for the durability rationale.

The operator-started workflow type is
`runScoutWeeklyParlayCatchupWorkflow`. Its input is `{ periodKey, slot }`, and
its workflow ID is `scout-weekly-parlay-catchup-<periodKey>-<slot>`. Temporal
rejects a duplicate live ID. The workflow does not create or modify the
recurring schedule.

## Glitter

| Workflow                  | Trigger                      | Brain             | Output               |
| ------------------------- | ---------------------------- | ----------------- | -------------------- |
| corpus capture            | daily 04:15                  | deterministic     | immutable S3 corpus  |
| context-refresh           | Mon 11:00                    | LLM (cost-capped) | PR                   |
| corpus inventory          | operator (`glitter:operate`) | deterministic     | channel-scope object |
| corpus backfill           | operator (`glitter:operate`) | deterministic     | immutable S3 corpus  |
| channel backfill (canary) | operator (`glitter:operate`) | deterministic     | immutable S3 corpus  |
| channel overlap           | child of daily capture       | deterministic     | drift re-backfill    |

Only corpus capture and context-refresh are scheduled.

## Homelab maintenance

| Workflow                        | Trigger       | Brain         | Output                                   |
| ------------------------------- | ------------- | ------------- | ---------------------------------------- |
| zfs-maintenance                 | Sun 03:00     | deterministic | scrub + autotrim                         |
| buildkite-uv-cache-prune-weekly | Sun 03:15     | deterministic | uv cache prune                           |
| bugsink-housekeeping            | daily 03:00   | deterministic | DB cleanup                               |
| velero-orphan-audit             | daily 03:30   | deterministic | metrics only                             |
| kometa-daily                    | daily 04:30   | deterministic | Plex metadata sync                       |
| buildkite-bun-cache-gc          | every 5 min   | deterministic | Bun cache GC                             |
| buildkite-trivy-db-refresh      | every 6 hours | deterministic | Trivy database refresh                   |
| dns-audit                       | daily 06:00   | deterministic | logs                                     |
| golink-sync                     | daily 05:00   | deterministic | golink reconcile                         |
| temporal-failure-watch          | every 5 min   | deterministic | durable alert occurrence                 |
| report-freshness-monitor        | every 15 min  | deterministic | metrics + durable alert                  |
| TaskNotes canary                | daily 09:00   | deterministic | heartbeat email                          |
| main-vuln-scan                  | Sun 05:00     | deterministic | report email + durable alert on CRITICAL |

## Home automation

| Workflow           | Trigger                 | Brain         | Output               |
| ------------------ | ----------------------- | ------------- | -------------------- |
| good-morning ×3    | weekday/weekend crons   | deterministic | heat, music, scenes  |
| vacuum-if-not-home | 09/12/17:00             | deterministic | vacuum fleet         |
| welcome-home       | arrival edge            | deterministic | scenes, lights, dock |
| leaving-home       | last-departure edge     | deterministic | lights off, vacuums  |
| reconcile-lock     | every presence edge     | deterministic | deadbolt (settled)   |
| good-night         | iOS shortcut            | deterministic | scene + sleep audio  |
| sleep-music        | iOS Shortcut + duration | deterministic | bedroom sleep audio  |
| sleep-ac           | iOS Shortcut + duration | deterministic | bedroom cooling      |

Parameters for the sleep and morning routines are in
[Home automation routines](/reference/home-automation-routines/).

## GitHub PRs

| Workflow             | Trigger             | Brain         | Output           |
| -------------------- | ------------------- | ------------- | ---------------- |
| merge-conflict check | PR push / main push | deterministic | required status  |
| buildkite-cancel     | PR close            | deterministic | cancelled builds |

## Agent tasks

| Workflow                 | Trigger               | Brain                             | Output          |
| ------------------------ | --------------------- | --------------------------------- | --------------- |
| agent-task               | doc block / CLI / API | **agent** investigation           | heartbeat email |
| homelab-audit-daily      | daily 06:30           | collectors + optional LLM summary | heartbeat email |
| homelab-audit (operator) | operator CLI          | same deterministic implementation | heartbeat email |

All heartbeat emails use one validated report envelope. A clear status requires
successful evidence for every required check; partial and failed runs still
send. Models cannot select the status or subject.

## Related

- [Schedule reference](/reference/temporal-schedules/) — cron mechanics
- [Roll out Scout's Temporal workers](/how-to/roll-out-scout-temporal/) — cutover and soak procedure
- [Agent task input](/reference/agent-task-input/) — the task schema
- [Why Temporal](/explanation/temporal/overview/) — what the fleet is for
