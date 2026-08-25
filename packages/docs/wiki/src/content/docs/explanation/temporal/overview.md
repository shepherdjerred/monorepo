---
title: Why Temporal
description: What durability buys for household automation and repo upkeep, and why the fleet runs as two processes rather than one.
sidebar:
  order: 1
---

`packages/temporal` is the monorepo's automation hub. Every recurring job, PR
bot, scheduled agent, Glitter refresh, and home-automation routine runs here as
a durable workflow.

```mermaid
flowchart LR
  accTitle: Temporal worker system map
  accDescr: The Temporal server dispatches general and agent work to the core Bun worker, Glitter work to dedicated workers, maintenance to Buildkite, and competition delivery activities to each Scout environment. Webhooks, APIs, and Home Assistant events enter through the core worker.

  S[Cron schedules] --> T[Temporal server]
  T --> C[Core Bun worker<br/>default + agent-task]
  T --> G[Glitter Bun worker<br/>corpus + context]
  T --> SB[Scout beta<br/>competition activities]
  T --> SP[Scout prod<br/>competition activities]
  W[GitHub and Xcode webhooks] --> C
  H[Home Assistant events] --> C
  A[Agent-task API] --> C
  C --> O[PRs, reports, HA actions]
  G --> D[Discord corpus and context PRs]
  C --> M[Health and metrics]
  G --> M
```

## Durability is the point

A cron job that dies halfway through leaves no trace and no way to resume.
Temporal workflows survive worker restarts and server outages, retries and
timeouts are declarative, and schedule catchup windows replay missed runs after
downtime.

That matters more than it sounds for this workload. A morning heating routine
that half-ran is worse than one that did not run, and a repo-upkeep job that
died after pushing a branch but before opening a PR leaves debris someone has to
find.

## Schedules in code, not in a UI

All schedules live in a single array and reconcile at every worker boot.

The alternative — creating schedules in the Temporal UI — means the automation
inventory exists only as accumulated clicks that nobody reviews and no diff
records. Putting it in code makes a PR the change process and makes the full
fleet reviewable in one file.

Pause state is the deliberate exception: it is runtime state, preserved across
reconciliation, because pausing is an operational act rather than a design
change.

## Six processes, seven queues

The core deployment owns `default`. A dedicated report-only agent deployment
owns `agent-task`, and a separate Glitter deployment owns `glitter-corpus` and
`glitter-context`. A fourth, tokenless maintenance deployment in the Buildkite
namespace owns the serial `maintenance` queue. All four run the same image and
workflow bundle, selected by a strict process role. Two more processes, the Scout beta and
production backends add activity-only workers on `scout-beta` and `scout-prod`;
those workers keep each environment's database and Discord credentials inside
the service that already owns them.

The split is about authorization and failure isolation, not capacity. Queues
isolate concurrency; **processes** isolate runtime failures and Kubernetes
identities. The agent service account can collect read-only cluster evidence but
has none of the pod-exec roles used by deterministic canaries and maintenance.
Glitter's work is long, memory-hungry, and rate-limited against Discord —
exactly the profile that would otherwise starve or destabilise ordinary jobs
sharing a process.

Each dedicated Temporal process serves `/healthz` from Bun's event loop only
after its workers finish startup. The Scout activity workers share their
backend's existing health lifecycle. Independent startup, readiness, and
liveness probes restart a wedged deployment without taking down the others.
Metrics are scraped per service role.

## Batteries in the image

The worker image bakes `gh`, `claude`, `codex`, `kubectl`, `talosctl`, `tofu`,
and `argocd`, so workflows can operate the homelab and run coding agents as
subprocesses.

This is a real trade: a fatter image and a broader blast radius in exchange for
workflows that can do useful operational work instead of only calling APIs. The
[agent task boundary](/explanation/temporal/agent-task-boundary/) is where that
trade gets examined honestly.

## Self-contained by design

No other package imports its workflow implementation. All integration is at
runtime — it consumes workspace libraries, clones the monorepo to open PRs,
receives webhooks, and dispatches activities over named task queues.

The rest of the repo talks to it only through its surfaces, which is what lets
it be deployed and restarted independently of everything it automates.

## Related

- [Workflow families](/explanation/temporal/workflow-families/) — what actually runs
- [Event-driven surfaces](/explanation/temporal/event-surfaces/)
- [Temporal workflow inventory](/reference/temporal-workflows/)
