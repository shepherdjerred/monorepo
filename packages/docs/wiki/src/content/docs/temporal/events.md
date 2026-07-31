---
title: Event-driven surfaces
description: GitHub PR workflows, an Xcode Cloud failure webhook, and the Home Assistant event bridge — the worker's reactive side.
---

Beyond the cron fleet, the worker reacts to three event sources: GitHub PR
webhooks, Xcode Cloud build webhooks, and Home Assistant state changes. Each
public HTTP surface is a Cloudflare Tunnel to a dedicated port on the worker.

| Surface                 | Public host                     | Triggers                                             |
| ----------------------- | ------------------------------- | ---------------------------------------------------- |
| GitHub webhook receiver | `pr-bot.sjer.red`               | Merge-conflict check, Buildkite build cancel         |
| Agent-task API          | `temporal-agent-tasks.sjer.red` | [Agent tasks](/temporal/agent-tasks/) (bearer-token) |
| Xcode Cloud webhook     | `xcode-cloud-webhook.sjer.red`  | iOS build failures → Alertmanager alerts             |

## GitHub PR workflows

One GitHub webhook fans out to independent workflows per event
([deep dive](/temporal/workflows/pr-bots/)):

- **Merge-conflict check** — posts the `ci/merge-conflict` commit status.
  This is a _required_ check in the repo's rulesets, so the worker being down
  blocks merges — the one place the homelab sits in the merge path.
- **Build cancel** — closing a PR cancels its in-flight Buildkite builds.

An in-house PR review/babysit bot fleet also lived here until 2026-07-31;
it was removed in favor of the CI review gate
([#1863](https://github.com/shepherdjerred/monorepo/pull/1863)).

## Home Assistant bridge

The worker subscribes to Home Assistant events over websocket and starts
workflows on `ios.action_fired` and presence transitions (deep dive:
[home automation workflows](/temporal/workflows/home-automation/)). Presence-driven
automation (welcome-home, leaving-home, door-lock reconciliation) is debounced
through a singleton workflow with a 90-second cooldown, so a person flapping
at the edge of a zone cannot rapid-fire the lock. Time-of-day routines
(good-morning, vacuum) come from [schedules](/temporal/schedules/) instead —
events for state changes, crons for wall-clock behavior.

## Why webhooks and not polling

GitHub and Xcode Cloud push events land in seconds and cost nothing when
idle — nothing here polls. The event bridge lives in
[`src/event-bridge/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/temporal/src/event-bridge).
