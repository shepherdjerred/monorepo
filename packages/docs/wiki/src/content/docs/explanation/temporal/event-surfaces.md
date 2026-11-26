---
title: The worker's reactive side
description: Four event sources, why they are webhooks rather than polls, and the one place the homelab sits in the merge path.
sidebar:
  order: 3
---

Beyond the cron fleet, the worker reacts to four event sources: GitHub PR
webhooks, Xcode Cloud build webhooks, direct sleep webhooks, and Home Assistant
state changes.

Each public HTTP surface is a Cloudflare Tunnel to a dedicated port on the
worker.

| Surface                 | Public host                     | Triggers                                                                   |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| GitHub webhook receiver | `pr-bot.sjer.red`               | merge-conflict check, weighted round-robin code review, CI pipeline cancel |
| Agent-task/chat API     | `temporal-agent-tasks.sjer.red` | agent tasks and durable chats (bearer-token)                               |
| Sleep webhook           | `temporal-sleep.sjer.red`       | sleep workflows (bearer-token)                                             |
| Xcode Cloud webhook     | `xcode-cloud-webhook.sjer.red`  | iOS build failures → Alertmanager alerts                                   |

## Events for state, crons for wall-clock

The split is not arbitrary. Presence transitions and PR pushes are _state
changes_ — you want to know the moment they happen, and polling for them wastes
requests to learn nothing.

Morning routines and vacuum runs are _wall-clock behaviour_. There is no event
to subscribe to; the trigger is the time itself.

So presence-driven automation is event-driven and time-of-day routines are
[schedules](/reference/temporal-schedules/).

## Why webhooks and not polling

GitHub and Xcode Cloud events land in seconds and cost nothing when no build or
pull request is active.

For a homelab that is running continuously, an idle cost of zero is worth more
than it would be in a system that scales down.

## The one place the homelab blocks merging

Temporal posts two **required** commit statuses in the repository's ruleset:
`ci/merge-conflict` and `ci/code-review`
([`github-webhook.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/event-bridge/github-webhook.ts)).

A worker outage therefore blocks merges. Keeping both checks on the always-on
worker is a deliberate coupling rather than an oversight.

Conflicts come from a local `git merge-tree --write-tree` in a bare workdir,
never GitHub's lazy `mergeable` field
([`check-pr-merge-conflicts.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/ci/check-pr-merge-conflicts.ts)).
Main pushes recompute every open pull request without starting CI pods.

Automated review orchestration belongs here for the same reason
([`pr-code-review.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/ci/pr-code-review.ts)).
Provider fairness, cooldowns, and thread-resolution watches outlive any single
pipeline pod; see [How CI selects work](/explanation/ci-pipeline-shape/#the-review-gate-waits-for-the-exact-head).

## Debouncing presence

Presence data flaps. A phone at the edge of the home zone can report leave and
arrive several times a minute.

Everything presence-driven is built around a 90-second settle window. The front
door lock and occupied heat use a stronger shape: a singleton reconciler that
reads live state after the window rather than acting on the edge that woke it.
Heat parameters are on [Home automation routines](/reference/home-automation-routines/).

The predecessor design ran independent timers per edge and could audibly
unlock-then-lock on a single flap. When the side effect is a deadbolt in a quiet
house, "eventually consistent" is not good enough.

## Redelivery is safe, but not uniformly

What a redelivered webhook does depends on each target's workflow-ID policy. The
merge-conflict check is keyed per PR and _supersedes_ an in-flight run.

Code review is keyed by PR and head SHA: `USE_EXISTING` reuses an in-flight run,
`ALLOW_DUPLICATE` lets post-completion deliveries re-evaluate the head, and
close or draft events signal `recheckReview` to stop obsolete runs
([`code-review-starts.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/event-bridge/code-review-starts.ts)).
CI cancel is keyed by commit and no-ops duplicates.

Each path bounds duplicate deliveries at the workflow boundary that fits its
lifecycle.

## A removed fleet

An in-house LLM reviewer and PR babysitter fleet lived here until 2026-07-31
([#1863](https://github.com/shepherdjerred/monorepo/pull/1863)).

That reviewer never left dry-run, babysit sat dormant, and together they carried
120 source files plus a dedicated Redis. Current PR code-review workflows only
coordinate external review providers and store state in Temporal itself.

## Related

- [Temporal workflow inventory](/reference/temporal-workflows/)
- [Home automation routines](/reference/home-automation-routines/)
- [Build the sleep Shortcut](/how-to/build-the-sleep-shortcut/)
