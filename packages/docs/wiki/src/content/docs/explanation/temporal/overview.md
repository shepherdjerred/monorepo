---
title: Why Temporal
description: What durability buys for household automation and repo upkeep, and why each workload domain has its own worker.
sidebar:
  order: 1
---

`packages/temporal` is the monorepo's automation hub. Every recurring job, PR
bot, scheduled agent, Glitter refresh, and home-automation routine runs here as
a durable workflow.

```mermaid
flowchart LR
  accTitle: Temporal worker system map
  accDescr: A tokenless gateway reconciles schedules and receives public requests. Temporal dispatches each workflow and activity to one of nine domain queues. Home Assistant events enter through the home worker. Every domain has independent health and metrics endpoints.

  S[Schedule definitions] --> G[Gateway<br/>control role]
  W[Public webhooks and APIs] --> G
  G --> T[Temporal server]
  E[Home Assistant events] --> H[Home worker]
  H --> T
  T --> H
  T --> R[Reports worker]
  T --> I[Infra worker]
  T --> P[Repo worker]
  T --> C[Scout worker]
  T --> A[Agent worker]
  T --> D[Glitter corpus worker]
  T --> X[Glitter context worker]
  T --> M[Maintenance worker]
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

## Ten processes, nine queues

The gateway is a control process: it reconciles schedules and serves the public
HTTP surfaces but does not poll a task queue or receive a Kubernetes token.
Nine workers own `home`, `reports`, `infra`, `repo-automation`, `scout`,
`agent-task`, `glitter-corpus`, `glitter-context`, and `maintenance`. All ten
run the same image and deterministic workflow bundle, selected by a strict
process role. The old `default` queue has no worker or start site.

The split is about authorization and failure isolation, not capacity. Queues
isolate concurrency; **processes** isolate runtime failures, credentials, and
Kubernetes identities. Home and reports can each run four activities. Infra,
repo, Scout, agent, both Glitter domains, and maintenance remain serial.

Only infra receives the broad audit and pod-exec roles. Gateway, home, reports,
repo, Scout, and both Glitter workers disable service-account token mounting.
Each Deployment receives an allowlisted environment. Network policies, Services,
and ServiceMonitors select the unique `component` label rather than the shared
image label. Each process serves `/healthz` after startup, with independent
probes and per-queue metrics.

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
