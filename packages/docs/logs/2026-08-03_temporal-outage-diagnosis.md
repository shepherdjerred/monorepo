---
id: log-2026-08-03-temporal-outage-diagnosis
type: log
status: complete
board: false
---

# Temporal Outage Diagnosis

## Question

Why is the production Temporal service down?

## Investigation

Temporal itself is serving. The production failure is a wedged TypeScript SDK
worker process: it is alive according to Kubernetes, but it is no longer polling
the `default` workflow task queue.

### Healthy control plane and dependencies

- Both Talos nodes are `Ready`; the Temporal namespace has no warning events.
- PostgreSQL, Temporal server, Temporal UI, and the worker pod are all
  `Running` with zero restarts. The PVC is bound, and service endpoint slices
  are populated.
- ArgoCD reports the `temporal` application `Synced` and `Healthy` at worker
  image `ghcr.io/shepherdjerred/temporal-worker:2.0.0-7749`.
- The Temporal gRPC health service reports `SERVING`; the UI and its namespace
  API both return HTTP 200.

### Failed worker path

- The `default` queue has 10 workflow tasks with an approximately 1 hour 29
  minute oldest-task age and a dispatch rate of zero. It has an activity poller
  but no workflow poller.
- The worker pod remains Kubernetes-ready with zero restarts, while consuming
  approximately 0.9-1.0 CPU core and 2.34 GiB of memory. It has no
  liveness/readiness probe that tests workflow-task polling, so Kubernetes only
  knows that the container process exists.
- Sampling `/proc/1/task` showed one unnamed Bun/JavaScriptCore thread consuming
  a full core while the main thread and the named Temporal Core workflow threads
  were sleeping. The pod permissions do not permit reading that thread's native
  stack, so its exact runtime function is not proven.
- Workflows on the `default` queue repeatedly time out their 10-second workflow
  tasks. The `good-morning` workflow is one affected workflow, but its failure
  began after the worker stopped making progress; its bounded preheat loop is
  not the trigger.

### Trigger and timeline

Prometheus shows the worker changing from approximately 0.06 CPU core to a
continuous full core between `2026-08-03T13:07:30Z` and `13:08:00Z`. Memory
simultaneously peaked at approximately 2.67 GB before settling near 2.45 GB.
There were no restarts.

That transition coincides exactly with completion of the unusually large
`glitter-corpus-daily-workflow-2026-08-03T11:15:00Z` run:

- The parent ran for 1 hour 52 minutes, produced 212,683 messages, and reached
  2,426 history events. Its 267 full-backfill children scheduled 5,115
  activities and produced approximately 67.5 MB of history JSON in aggregate.
- Two consecutive channel children were unusually large: 7,085 events / 58,873
  messages and 10,013 events / 83,242 messages. The larger child alone scheduled
  1,668 activities and produced approximately 23.8 MB of history JSON.
- The final child completed at `13:06:59Z`; snapshot finalization and the parent
  completed at `13:07:39Z`, within the same metrics interval in which the
  worker thread pinned a core.

The strongest supported diagnosis is therefore: the full Glitter refresh
coincided with a nondeterministic stall in the shared Bun worker process,
leaving an unnamed thread spinning and the JavaScript event loop unable to make
progress. The live evidence proves the process-level failure but does not prove
whether its low-level origin is Bun, the Temporal SDK, application code, or an
interaction among them. Temporal still tracks
[full Bun support as an open feature request](https://github.com/temporalio/sdk-typescript/issues/2273),
which makes that compatibility boundary relevant, but the successful replays
and stress tests do not justify identifying Bun itself as the root cause.

All four queue workers are created inside one Bun process in
`packages/temporal/src/worker.ts`, so separate Temporal task queues do not
provide process/runtime fault isolation. The per-channel corpus workflow also
accumulated 10,013 history events without continuing as new.

### Further reproduction and exclusions

- The successful August 2 parent had effectively the same 2,426-event parent
  history and final payload sizes, and reached a higher memory peak than the
  failed August 3 process before recovering. A simple parent-size or memory
  threshold therefore does not explain the incident.
- Exact August 2 and August 3 parent histories and the 10,013-event child replay
  successfully under Bun. The full sequence of all 267 recorded child histories
  plus the parent also replays successfully in the exact production image.
- A real local Temporal worker running the exact production image completed two
  consecutive mocked children matching the large production activity/message
  counts, then completed a cleanup workflow.
- A final controlled run exercised the complete 267-channel weekly-refresh
  shape under the production 6 GiB / 1.5 CPU limits. It stayed responsive for
  8.5 minutes, processed activities continuously, and recovered through repeated
  garbage-collection cycles; it was stopped to avoid extending the diagnosis.

These negative tests rule out deterministic workflow nondeterminism, recorded
history replay, the two large child workflows alone, and a simple memory limit
as sufficient causes. They do not rule out a timing-sensitive runtime defect or
an interaction with the other queue workers that share the production process.

After the initial event-loop stall, the `default` worker accumulated occupied
workflow slots until all 40 SDK-default slots were full. Its workflow pollers
then fell to zero and the task backlog grew. The missing poller was therefore a
downstream cascade from the process stall, not the initiating failure.

## Recovery boundary

No restart or other live mutation was performed. Restarting the worker would
probably restore polling, but it can interrupt the active `agent-task` work and
release delayed time-sensitive workflows. Recovery should account for those
effects before restarting the pod.

The durable remediation keeps Bun while isolating the Glitter queues into a
separate deployment/process and probing an event-loop-backed health endpoint.
That contains a recurrence to one role and lets Kubernetes restart a process
that exists but cannot service HTTP. Missing-poller and backlog alerts remain a
useful additional detection layer; history rollover should be evaluated
separately because the recorded histories replayed successfully.

## Session Log — 2026-08-03

### Done

- Verified live Kubernetes, ArgoCD, Temporal gRPC/UI, PostgreSQL, queue, workflow
  history, process-thread, and Prometheus evidence.
- Identified the immediate failure as a spinning Bun/JavaScriptCore thread,
  followed by workflow-slot saturation and loss of the `default` poller.
- Correlated the failure onset to finalization of the weekly Glitter full
  refresh and quantified its 267 children, 5,115 activities, and two largest
  histories.
- Replayed the exact histories and exercised equivalent real-worker workloads
  in the production image without reproducing the wedge, excluding deterministic
  workflow, history, and simple memory-threshold explanations.
- Cross-checked Temporal's current experimental Bun-support status and narrowed
  the remaining uncertainty without claiming that Bun itself caused the stall.
- Added explicit `core`, `glitter`, and backward-compatible `all` Bun worker
  roles with strict environment parsing and regression tests.
- Split Glitter into a separate Kubernetes Deployment with independent SDK and
  application metrics Services and event-loop-backed startup, readiness, and
  liveness probes on `/healthz`.
- Added synthesized-manifest regression coverage for the role split, probe
  configuration, and exposed ports.
- Updated the package operator reference and human Temporal architecture page
  to document the two Bun process roles and their failure boundary.
- Merged the durable implementation in PR #1972 at feature commit
  `e90062752c868027a97118fff97301609be49c57`; exact-head focused checks and the
  exhaustive Buildkite verify graph passed.
- Published the documentation follow-up as PR #1976 with a rendered system-map
  screenshot; its exact-head verify, Playwright, deploy-path drift, and
  Temporal image build/smoke jobs passed before merge at `7f7c16bdf`.
- Published and smoke-tested the feature-bearing Bun image as
  `2.0.0-7909@sha256:8f7a0c662ddc7afd9c6a5c1ec7c8f4252cffb98682da30e53ac471fcfe25ff11`,
  then merged its durable version pin in generated PR #1977 at `117fab698`.
- Verified the live rollout has separate Ready `core` and `glitter`
  Deployments on that exact image, event-loop startup/readiness/liveness probes,
  independent metrics endpoints, and HTTP 200 health responses.
- Verified current queue polling follows the intended boundary: the core pod
  polls `default` and `agent-task`, while the Glitter pod polls
  `glitter-corpus` and `glitter-context`.

### Remaining

- None.

### Caveats

- The trigger correlation is strong, but the exact low-level defect remains
  unproven. Capturing it requires an invasive live native stack or a future
  recurrence with CPU profiling enabled.
- No manual restart was performed. The old single-process pod restarted during
  the investigation, and the subsequent GitOps rollout replaced it with the two
  isolated worker roles.
- Main build #7909 published the exact image and began the successful rollout,
  then was canceled after the automated pin and documentation merges triggered
  newer main builds. Runtime state and merged desired state were therefore
  verified directly instead of treating the canceled predecessor as green-main
  proof.
- The wiki's Bun unit tests pass, but local Astro 7/Vite 8 typecheck and build
  fail during content-config loading with
  `Tsconfig not found /tsconfig.base.json` in this nested worktree. A minimal
  Astro config failed at the same content-sync boundary, and attempted config
  and tsconfig-path workarounds were removed. Exact-head Buildkite remains the
  independent verification for the rendered page.

## Workflow Friction

- `packages/docs/wiki` cannot currently run its required Astro render checks
  from a nested `.claude/worktrees/` checkout because Vite 8 resolves an
  inherited config as `/tsconfig.base.json`. The wiki needs a documented,
  reproducible worktree-safe config-loading fix so visual documentation changes
  can be rendered and captured before publication.
- `gh stack submit --auto` unexpectedly converted both submitted branches from
  draft state, and PR #1972 then auto-merged before the requested verification
  was complete. The native-stack workflow needs a reliable noninteractive way
  to preserve draft state until the agent explicitly promotes a PR.
