---
name: temporal-development
description: Build, test, deploy, or operate this monorepo's Temporal workflows, activities, workers, task queues, and schedules. Use for packages/temporal or Scout Temporal integration; use a generic Temporal reference skill for SDK concepts alone.
---

# Temporal development

Temporal owns every scheduled and recurring workload in this repository.
Central workflows live in `packages/temporal`; Scout domain workflows live in
Scout's Temporal package. Read the local AGENTS file and README for the boundary
you change.

- Workflow code must remain deterministic. Time, I/O, network, filesystem,
  process, and secrets belong in Activities.
- Changes to Workflow history behavior need replay/versioning analysis. Never
  assume a deployment can safely reinterpret open executions.
- Define recurring work in `src/schedules/schedule-definitions.ts`; do not add a
  CronJob or timer.
- Keep task queues, namespaces, schedules, and worker ownership explicit.
- Activities use deliberate timeouts, retries, heartbeats, and cancellation.
  External writes need idempotency or a durable effect checkpoint.
- A terminal external or quota failure is not automatically retryable. Preserve
  the semantic distinction between failure, deferral, and operator action.
- Use the shared typed agent-task contract and environment sanitizer. Deployed
  inference goes through the repository runtime and approved credential path.

Run focused build, typecheck, test, lint, and replay tests for changed Workflows.
For live work, identify namespace, workflow ID, run ID, task queue, worker build,
and schedule before mutation. Inspect histories and pending Activities rather
than inferring from a UI summary.

Do not cancel a healthy durable timer merely because it is quiet. Source tests,
worker registration, schedule state, Workflow completion, and downstream
delivery are separate acceptance layers.
