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

| Surface                 | Public host                     | Triggers                                     |
| ----------------------- | ------------------------------- | -------------------------------------------- |
| GitHub webhook receiver | `pr-bot.sjer.red`               | merge-conflict check, Buildkite build cancel |
| Agent-task API          | `temporal-agent-tasks.sjer.red` | agent tasks (bearer-token)                   |
| Sleep webhook           | `temporal-sleep.sjer.red`       | sleep workflows (bearer-token)               |
| Xcode Cloud webhook     | `xcode-cloud-webhook.sjer.red`  | iOS build failures → Alertmanager alerts     |

## Events for state, crons for wall-clock

The split is not arbitrary. Presence transitions and PR pushes are _state
changes_ — you want to know the moment they happen, and polling for them wastes
requests to learn nothing.

Morning routines and vacuum runs are _wall-clock behaviour_. There is no event
to subscribe to; the trigger is the time itself.

So presence-driven automation is event-driven and time-of-day routines are
[schedules](/reference/temporal-schedules/).

## Why webhooks and not polling

GitHub and Xcode Cloud push events land in seconds and cost nothing when idle.
Nothing here polls.

For a homelab that is running continuously, an idle cost of zero is worth more
than it would be in a system that scales down.

## The one place the homelab blocks merging

The merge-conflict check posts the `ci/merge-conflict` commit status, which is a
**required** check in the repo's rulesets.

That means the worker being down blocks merges. It is the single place the
homelab sits in the merge path, and it is a deliberate accepted coupling rather
than an oversight.

Conflicts are computed with a real local `git merge-tree --write-tree` in a bare
workdir — never GitHub's lazy `mergeable` field. Building a required check on an
unreliable upstream signal is exactly what the repo's engineering principles say
not to do.

## Debouncing presence

Presence data flaps. A phone at the edge of the home zone can report leave and
arrive several times a minute.

Everything presence-driven is built around a 90-second settle window, and the
front door lock gets stronger treatment still: a singleton reconciler that reads
live state after the window rather than acting on the edge that woke it.

The predecessor design ran independent timers per edge and could audibly
unlock-then-lock on a single flap. When the side effect is a deadbolt in a quiet
house, "eventually consistent" is not good enough.

## Redelivery is safe, but not uniformly

What a redelivered webhook does depends on the target's workflow-ID policy. The
merge-conflict check is keyed per PR and _supersedes_ an in-flight run; Buildkite
cancel is keyed by commit and no-ops a duplicate.

Both are safe. They are not the same kind of safe, which is worth knowing before
assuming a replay is free.

## A removed fleet

An in-house PR review and babysit bot fleet lived here until 2026-07-31. It was
removed in favour of the CI review gate
([#1863](https://github.com/shepherdjerred/monorepo/pull/1863)).

The review bot never left dry-run, babysit sat dormant, and together they carried
about 120 source files plus a dedicated Redis, dashboards, and alert rules. The
three workflows that remain are the ones that earned their keep.

## Related

- [Temporal workflow inventory](/reference/temporal-workflows/)
- [Home automation routines](/reference/home-automation-routines/)
- [Build the sleep Shortcut](/how-to/build-the-sleep-shortcut/)
