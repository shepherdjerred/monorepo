---
title: Why Temporal
description: What durability buys for household automation and repo upkeep, and why each workload domain has its own worker.
sidebar:
  order: 1
---

`packages/temporal` is the monorepo's automation hub. Every recurring job, PR
bot, scheduled agent, Glitter refresh, and home-automation routine runs here as
a durable workflow.

The fleet uses `dev`, `beta`, and `prod` namespaces as execution trust
boundaries. A namespace separates workflow IDs, schedules, histories, and task
queues even when queue names match.

```mermaid
flowchart LR
  accTitle: Temporal worker system map
  accDescr: A tokenless gateway reconciles schedules and receives public requests. Temporal sends deterministic code to a credentialless Workflow worker and effects to ten Activity queues. Home Assistant events enter through the home worker. Every domain has independent health and metrics endpoints.

  S[Schedule definitions] --> G[Gateway<br/>control role]
  W[Public webhooks and APIs] --> G
  G --> T[Temporal server]
  E[Home Assistant events] --> H[Home worker]
  H --> T
  T --> F[Credentialless Workflow worker]
  F --> T
  T --> H[Home Activity worker]
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

## Workflow code and effects run apart

The gateway is a control process: it reconciles schedules and serves the public
HTTP surfaces but does not poll a task queue or receive a Kubernetes token. A
second credentialless process runs all deterministic central Workflow code.
Every new start, schedule, and child goes to `monorepo-workflows`. Ten
Activity-only roles own `default`, `home`, `reports`, `infra`,
`repo-automation`, `scout`, `agent-task`, `glitter-corpus`, `glitter-context`,
and `maintenance`. The `default` Activity Worker exists only to drain commands
already scheduled by pre-cutover histories; no new root targets it.

Temporal executions cannot move to another Workflow task queue after they
start. The Workflow-only process therefore polls `monorepo-workflows` plus all
legacy central queues until live visibility shows that each old queue has zero
open executions. Continue-as-new inherits the current queue, so new chains stay
on `monorepo-workflows` and old chains remain drainable. A replay test generated
a real history before Activity queues were explicit and verifies it against the
new routing on every change.

The split is about authorization and failure isolation, not capacity. Queues
isolate concurrency; **processes** isolate runtime failures, credentials, and
Kubernetes identities. Home and reports can each run four activities. Infra,
repo, Scout, agent, both Glitter domains, and maintenance remain serial.

Namespace isolation adds the deployment-stage boundary that queues cannot
provide. Scout beta and prod keep identical queue contracts without consuming
each other's work. Shared and cross-stage jobs belong to the `prod` control
plane. Local servers use `dev`, which never exists in the cluster.

The central `scout` queue has one deliberate exception: its worker polls both
`prod` and `beta` because the beta-owned weekly parlay and Bryan Bucks
analytics workflows remain in the central workflow bundle. This preserves the
existing queue contract; clients and shared Scout schedules still start only
in `prod`.

Existing histories cannot move between namespaces. The migration therefore
keeps bounded worker-only pollers in `default` until those histories close.
Clients and schedule reconcilers never target that drain namespace.

Infra and the temporary legacy worker receive the broad audit and pod-exec
roles. Agent receives read-only audit access but cannot exec into pods. Gateway,
the Workflow worker, home, reports, repo, Scout, and both Glitter workers
disable service-account token mounting. Each Deployment receives an allowlisted
environment. Network policies, Services, and ServiceMonitors select the unique
`component` label rather than the shared image label. Each process serves
`/healthz` after startup, with independent probes and per-queue metrics.

The Workflow pod receives no application credentials, secret volumes, or
Kubernetes API token. Its NetworkPolicy allows only DNS, Temporal gRPC, OTLP,
and metrics scraping. Activity pods retain only the credentials and network
paths required by their domain.

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
