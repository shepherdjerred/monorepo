---
title: Event-driven surfaces
description: GitHub PR bots, an Xcode Cloud failure webhook, and the Home Assistant event bridge — the worker's reactive side.
---

Beyond the cron fleet, the worker reacts to three event sources: GitHub PR
webhooks, Xcode Cloud build webhooks, and Home Assistant state changes. Each
public HTTP surface is a Cloudflare Tunnel to a dedicated port on the worker.

| Surface                 | Public host                     | Triggers                                                                  |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| GitHub webhook receiver | `pr-bot.sjer.red`               | PR review, summary, babysit, merge-conflict check, Buildkite build cancel |
| Agent-task API          | `temporal-agent-tasks.sjer.red` | [Agent tasks](/temporal/agent-tasks/) (bearer-token)                      |
| Xcode Cloud webhook     | `xcode-cloud-webhook.sjer.red`  | iOS build failures → Alertmanager alerts                                  |

## PR bots

One GitHub webhook fans out to independent workflows per event:

- **Review** — a multi-specialist review pipeline posts findings on opened
  PRs; a cheap summary pipeline posts a PR description comment.
- **Merge-conflict check** — posts the `ci/merge-conflict` commit status.
  This is a _required_ check in the repo's rulesets, so the worker being down
  blocks merges — the one place the homelab sits in the merge path.
- **Babysit** — commenting `@temporal-worker help me get this green` on a PR
  starts a durable workflow that drives the PR toward passing checks.
- **Build cancel** — closing a PR cancels its in-flight Buildkite builds.
- **Reaction listener** — a boot-started, self-recycling workflow polls for
  👎 reactions on bot comments as a feedback signal.

## Home Assistant bridge

The worker subscribes to Home Assistant events over websocket and starts
workflows on `ios.action_fired` and presence transitions. Presence-driven
automation (welcome-home, leaving-home, door-lock reconciliation) is debounced
through a singleton workflow with a 90-second cooldown, so a person flapping
at the edge of a zone cannot rapid-fire the lock. Time-of-day routines
(good-morning, vacuum) come from [schedules](/temporal/schedules/) instead —
events for state changes, crons for wall-clock behavior.

## Why webhooks and not polling

GitHub and Xcode Cloud push events land in seconds and cost nothing when idle;
the only poller is the reaction listener, where GitHub offers no webhook. The
event bridge lives in
[`src/event-bridge/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/temporal/src/event-bridge).
