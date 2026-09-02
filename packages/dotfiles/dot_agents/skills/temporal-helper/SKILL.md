---
name: temporal-helper
description: Safely design, implement, test, deploy, debug, and operate Temporal durable applications, with current TypeScript SDK, Workflow, Activity, Worker, Task Queue, Schedule, CLI, Cloud/server, replay, versioning, observability, and repository-specific Node/Bun guidance. Use for Temporal code or architecture, nondeterminism, retries/timeouts/heartbeats/cancellation, Signals/Queries/Updates, schedules, worker performance, production incidents, SDK upgrades, or live inspection and operations.
---

# Temporal Helper

Treat Event History as the durable source of truth, replay as the compatibility
oracle, and every live mutation as an explicitly authorized operation. Load only
the references needed for the request; verify current version/stage details
before using a drift-prone API.

## Route the request

1. **Establish the target.** Inspect repository instructions, installed
   `@temporalio/*` versions, runtime, Namespace configuration, and relevant
   Workflow/Activity/Worker code. Distinguish generic Temporal guidance from a
   repository exception.
2. **Classify the work.** Decide whether this is design/implementation, failure
   semantics, messaging/schedules, testing/deployment, Worker/capacity,
   TypeScript/runtime, read-only inspection, or a live mutation.
3. **Load the focused references.** Use the table below; do not load every file
   reflexively.
4. **Trace the durable boundary.** Identify which values and Commands enter
   Event History, which effects can repeat, and what must remain replay-compatible.
5. **Verify at the right layer.** A unit test, new-history integration test,
   replay test, bundle smoke test, live Service check, and downstream-effect
   check prove different things. Use independent evidence for the stated claim.

| Request | Read |
|---|---|
| Replay, determinism, histories, durable timers | [core execution model](references/core-execution-model.md) |
| Workflow/Activity boundary, idempotency, Local Activities | [Workflow and Activity design](references/workflow-activity-design.md) |
| Retries, timeouts, heartbeats, cancellation, failures | [failure semantics](references/failure-semantics.md) |
| Signals, Queries, Updates, children, Continue-As-New, Schedules | [messaging and Schedules](references/messaging-and-schedules.md) |
| Unit/integration/time-skipping/replay tests, patching, rollout | [testing, versioning, and deployment](references/testing-versioning-deployment.md) |
| Task Queues, routing, sticky execution, slots, pollers, shutdown | [Workers and Task Queues](references/workers-and-task-queues.md) |
| TypeScript packages, bundling, converters, Node/Bun | [TypeScript and runtime boundaries](references/typescript-runtime-boundaries.md) |
| Logs, metrics, traces, Visibility, security, Cloud/self-hosting | [operations and observability](references/operations-observability.md) |
| Incident triage and common anti-patterns | [troubleshooting](references/troubleshooting.md) |
| Current primary sources and feature-stage notes | [curated source map](references/sources.md) |

## Preserve the execution model

- Workflow code makes deterministic durable decisions. Put network, database,
  filesystem, secret, LLM, and other external effects in Activities.
- Replay reruns Workflow code and consumes recorded Activity results. A
  completed Activity is not rerun by replay; Activity attempts can repeat
  because of retry or ambiguous completion.
- Make every retriable Activity effect idempotent at the downstream boundary.
  Use a stable business key or Workflow Run ID plus Activity ID; never include
  attempt number in a deduplication key.
- Keep payloads small. Event History is an orchestration log, not object storage
  or a general query database.
- Any command-producing Workflow change needs replay analysis and, when
  incompatible, patching, current Worker Versioning, or a new Workflow type.

## TypeScript runtime boundary

Authentic Node 20, 22, or 24 is the officially supported Worker baseline. Client
portability to another JavaScript runtime does not imply Worker support.

This repository deliberately pins aligned `@temporalio/*` 1.22.0 packages and
runs production under Bun 1.4.0, while authentic Node runs real Workflow Worker
tests and replay. Upstream 1.23.0 added experimental Bun 1.4 VM, microtask, and
shutdown fixes, but did not make Bun an officially supported Worker runtime.
Preserve this as a tested repository exception. On every Bun or SDK upgrade,
revalidate Bun startup/bundling plus the complete authentic-Node Workflow and
representative replay suites.

## Separate inspection from mutation

Read-only inspection includes list/describe/history/Visibility, Task Queue and
Worker status, Schedule describe/list, and a Query known to be side-effect free.
Do not print sensitive payloads, headers, failure messages, or stacks.

Starts, Signals, Updates, cancellation, termination, reset, Schedule
create/update/pause/unpause/trigger/backfill/delete, and Workflow-version moves
change live state. Before any mutation:

1. Obtain user authorization for the exact action.
2. Resolve and state the exact Namespace plus Workflow ID and Run ID where
   applicable, or exact Schedule ID. Never infer a target from a similar name.
3. Describe current state and explain the state transition and duplicate-effect
   risk. Cancellation, termination, and reset are not interchangeable.
4. Preserve request identity/idempotency, use the narrowest operation, and do
   not expose credentials in commands or output.
5. Re-read the target, execution/history, Schedule, and relevant health or
   downstream state after the change.

If exact targeting, authorization, or version-specific semantics are missing,
continue read-only and ask for the missing authority rather than guessing.

## Repository rules

- All recurring work belongs in `packages/temporal` as a Workflow plus a
  declarative Schedule; do not add Kubernetes CronJobs, host crontabs, or
  in-process recurring timers.
- Repository clients and Workers require an explicit `TEMPORAL_NAMESPACE`:
  local development uses `dev`, Scout beta uses `beta`, and production plus
  shared control-plane jobs use `prod`. The shared cluster otherwise contains
  only Temporal's internal `temporal-system` namespace.
- Central Workflow tasks use `monorepo-workflows`; Scout Workflow tasks use the
  stage-bound `scout-beta` or `scout-prod` queue. `TEMPORAL_WORKER_ROLE=all` is
  an explicit local-development mode, never a production fallback.
- Existing executions stay on their recorded Task Queue. A new queue does not
  move them; preserve compatible pollers or use Worker Versioning.
- For Workflow code changes, replay retained histories and roll out the central
  Worker Deployment first, then Scout beta, then Scout production. Require
  queue canaries, clean alert windows, and the 24-hour observation gate before
  promotion.
- Use Bun for repository scripts and ordinary tests. Preserve authentic Node for
  native Workflow Worker, time-skipping, bundle, and replay acceptance.
- Keep the full `@temporalio/*` package family on one exact version. Confirm
  current examples against the repository pin or installed declarations.
- Never export `TEMPORAL_ADDRESS` globally. Use the repository's scoped profile
  and scripts so a local command cannot silently target production.
- Follow repository fail-fast and type-safety rules: no swallowed catches,
  assertion-based parsing, unvalidated heartbeat details, or hidden cleanup
  failures.

## Completion check

State what was proved: source review, unit behavior, real Worker execution,
time-skipping, production bundle, history replay, live Service state, downstream
effect, or deployment health. Report omitted live/production checks explicitly.
Do not collapse source correctness, replay compatibility, Worker readiness,
Service availability, and end-to-end business acceptance into one claim.
