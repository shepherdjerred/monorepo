---
name: temporal-helper
description: "Design, test, deploy, debug, and operate Temporal Workflows, Activities, Workers, task queues, Schedules,…"
---

# Temporal helper

Treat Workflow history as the durable program input. Workflow code must be
deterministic; I/O, clocks, filesystem, processes, and secrets belong in
Activities.

## Route by problem

- Execution semantics and event history:
  [core-execution-model.md](references/core-execution-model.md)
- Workflow and Activity boundaries:
  [workflow-activity-design.md](references/workflow-activity-design.md)
- Retries, timeouts, heartbeats, and cancellation:
  [failure-semantics.md](references/failure-semantics.md)
- Signals, Queries, Updates, and Schedules:
  [messaging-and-schedules.md](references/messaging-and-schedules.md)
- Workers, task queues, throughput, and pollers:
  [workers-and-task-queues.md](references/workers-and-task-queues.md)
- Tests, replay, Worker Versioning, and rollout:
  [testing-versioning-deployment.md](references/testing-versioning-deployment.md)
- CLI, visibility, metrics, and incidents:
  [operations-observability.md](references/operations-observability.md)
- TypeScript runtime and bundling boundaries:
  [typescript-runtime-boundaries.md](references/typescript-runtime-boundaries.md)
- Symptom-led diagnosis: [troubleshooting.md](references/troubleshooting.md)

For live work, identify namespace, workflow ID, run ID, task queue, worker
build, and schedule before mutation. Read history and pending tasks rather than
inferring from a summary. Distinguish retryable infrastructure failure from a
terminal domain outcome.

For Workflow changes, run unit/time-skipping tests as appropriate and replay
representative retained histories. Source checks, worker polling, open execution
compatibility, schedule state, and downstream effects are separate acceptance
claims.

Use [sources.md](references/sources.md) for authoritative documentation routes
and verify version-sensitive behavior against the installed SDK and server.
