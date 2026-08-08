---
title: Workflow inventory
description: Every workflow in the Temporal fleet — trigger, brain, and output — with links to each deep dive.
---

Every workflow the [Temporal worker](/temporal/) runs — scheduled,
event-driven, operator-started, or spawned as a child — grouped the way the
deep-dive pages are. "Brain" says what makes decisions: **deterministic**
code, an **LLM** call, or an **agent** subprocess with tools.

## Repo upkeep — [deep dive](/temporal/workflows/repo-upkeep/)

| Workflow            | Trigger     | Brain         | Output       |
| ------------------- | ----------- | ------------- | ------------ |
| fetcher             | daily 05:00 | deterministic | S3 overwrite |
| deps-summary        | Mon 09:00   | LLM summary   | email        |
| readme-refresh      | Mon 08:00   | deterministic | PR           |
| llm-catalog-refresh | Mon 09:00   | deterministic | PR           |
| homelab-crd-imports | daily 05:30 | deterministic | PR           |
| pokeemerald-data    | daily 04:30 | deterministic | PR           |

## Scout — [deep dive](/temporal/workflows/scout/)

| Workflow                   | Trigger       | Brain                    | Output                        |
| -------------------------- | ------------- | ------------------------ | ----------------------------- |
| data-dragon version check  | 06:00 Sun–Fri | deterministic            | **auto-merge PR**             |
| data-dragon weekly refresh | Sat 06:00     | deterministic            | **auto-merge PR**             |
| season-refresh             | Mon 07:00     | **agent** (web research) | PR                            |
| showcase-refresh           | Mon 10:00     | deterministic            | PR                            |
| queue-windows              | daily 06:45   | deterministic            | PR (auto-merge if reversible) |
| image-gc                   | daily 04:00   | deterministic            | S3 deletions                  |

## Glitter — [deep dive](/temporal/workflows/glitter/)

| Workflow                  | Trigger                      | Brain             | Output               |
| ------------------------- | ---------------------------- | ----------------- | -------------------- |
| corpus capture            | daily 04:15                  | deterministic     | immutable S3 corpus  |
| context-refresh           | Mon 11:00                    | LLM (cost-capped) | PR                   |
| corpus inventory          | operator (`glitter:operate`) | deterministic     | channel-scope object |
| corpus backfill           | operator (`glitter:operate`) | deterministic     | immutable S3 corpus  |
| channel backfill (canary) | operator (`glitter:operate`) | deterministic     | immutable S3 corpus  |
| channel overlap           | child of daily capture       | deterministic     | drift re-backfill    |

Only the first two are scheduled; the inventory, backfill, and canary runs are
operator-started via `bun run glitter:operate`, and channel overlap is spawned
as a child of the daily capture.

## Homelab maintenance — [deep dive](/temporal/workflows/homelab-maintenance/)

| Workflow               | Trigger     | Brain         | Output           |
| ---------------------- | ----------- | ------------- | ---------------- |
| zfs-maintenance        | Sun 03:00   | deterministic | scrub + autotrim |
| bugsink-housekeeping   | daily 03:00 | deterministic | DB cleanup       |
| velero-orphan-audit    | daily 03:30 | deterministic | metrics only     |
| dns-audit              | daily 06:00 | deterministic | logs             |
| golink-sync            | daily 05:00 | deterministic | golink reconcile |
| temporal-failure-watch | every 5 min | deterministic | PagerDuty page   |

## Home automation — [deep dive](/temporal/workflows/home-automation/)

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

## GitHub PRs — [deep dive](/temporal/workflows/pr-bots/)

| Workflow               | Trigger             | Brain         | Output              |
| ---------------------- | ------------------- | ------------- | ------------------- |
| merge-conflict check   | PR push / main push | deterministic | required status     |
| buildkite-cancel       | PR close            | deterministic | cancelled builds    |
| observe-review-signals | every 6h            | deterministic | metrics + S3 NDJSON |

## Agent tasks — [deep dive](/temporal/agent-tasks/)

| Workflow                 | Trigger               | Brain                 | Output         |
| ------------------------ | --------------------- | --------------------- | -------------- |
| agent-task               | doc block / CLI / API | **agent** (read-only) | emailed report |
| homelab-audit-daily      | daily 06:30           | **agent** (read-only) | emailed report |
| homelab-audit (operator) | operator CLI          | **agent** (read-only) | emailed report |
| agent-task-timeout-watch | hourly                | deterministic         | gauge + alert  |

Cron times are `America/Los_Angeles` wall-clock; the full schedule mechanics
are on [Scheduled automations](/temporal/schedules/).
