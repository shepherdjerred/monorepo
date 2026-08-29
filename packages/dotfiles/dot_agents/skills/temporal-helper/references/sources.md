# Curated source map

Reviewed 2026-08-28. Use these primary sources for normative claims and re-open
drift-prone pages before an implementation or live operation. Community incident
material informed troubleshooting patterns but is intentionally not a normative
source map.

## Execution model and failures

- [Workflow Execution](https://docs.temporal.io/workflow-execution) — durable
  execution, replay, caching, Runs.
- [Events and Event History](https://docs.temporal.io/workflow-execution/event) —
  durable history contents and replay role.
- [Workflow Definition](https://docs.temporal.io/workflow-definition) —
  determinism and command-producing changes.
- [Activity Definition](https://docs.temporal.io/activity-definition) —
  at-least-once execution, ambiguous completion, stable idempotency keys.
- [Retry Policies](https://docs.temporal.io/encyclopedia/retry-policies) — default
  Activity and Workflow retry behavior.
- [Application failures](https://docs.temporal.io/encyclopedia/application-failures) —
  failure types, wrapping, retryability.
- [Failure Converter](https://docs.temporal.io/failure-converter) — failure-field
  privacy and codec integration.

## Messages, histories, and Schedules

- [Sending Signals, Queries, and Updates](https://docs.temporal.io/sending-messages) —
  caller-side contracts and start-with-message behavior.
- [Handling Signals, Queries, and Updates](https://docs.temporal.io/handling-messages) —
  handlers, validators, concurrency, deduplication.
- [Continue-As-New](https://docs.temporal.io/workflow-execution/continue-as-new) —
  Run chains and history reset.
- [Child Workflows](https://docs.temporal.io/child-workflows) — child identity,
  lifecycle, and boundaries.
- [Schedules](https://docs.temporal.io/schedule) — overlap, catchup, pause,
  backfill, deletion, and Visibility semantics.

## Deployment, Workers, and Task Queues

- [Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning) —
  current Worker Deployment model, Pinned/Auto-Upgrade, Current/Ramping.
- [Safely deploying Workflow code](https://docs.temporal.io/develop/safe-deployments) —
  replay gates and compatible rollout.
- [Temporal Server 1.31 release](https://github.com/temporalio/temporal/releases/tag/v1.31.0) —
  Worker Deployments GA; legacy V1/V2 sunset with removal scheduled for 1.32;
  Priority/Fairness GA.
- [Task Queues](https://docs.temporal.io/task-queue) — dispatch, partitions,
  pollers, and persistence.
- [Task Queue Priority and Fairness](https://docs.temporal.io/develop/task-queue-priority-fairness) —
  current partition/product scope and limitations.
- [Sticky Execution](https://docs.temporal.io/sticky-execution) — cache routing
  and fallback.
- [Worker performance](https://docs.temporal.io/develop/worker-performance) —
  slots, pollers, tuners, eager behavior, metrics.
- [Worker capacity troubleshooting](https://docs.temporal.io/troubleshooting/worker-capacity) —
  backlog, latency, pollers, slots, crash/OOM interpretation.

## TypeScript SDK and testing

- [TypeScript Workflow basics](https://docs.temporal.io/develop/typescript/workflows/basics) —
  sandbox, imports, replay-aware APIs.
- [TypeScript Activity timeouts](https://docs.temporal.io/develop/typescript/activities/timeouts) —
  timeout scopes, heartbeat, cancellation, next retry delay.
- [TypeScript message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing) —
  typed handlers, concurrency, unfinished handlers.
- [TypeScript testing](https://docs.temporal.io/develop/typescript/best-practices/testing-suite) —
  Activity, time-skipping, integration, and replay layers.
- [TypeScript data conversion](https://docs.temporal.io/develop/typescript/best-practices/data-handling/data-conversion) —
  converters and compatibility.
- [SDK README at repository pin 1.22.0](https://github.com/temporalio/sdk-typescript/blob/v1.22.0/README.md) —
  package alignment and official Node support for the pinned release.
- [SDK 1.23.0 release](https://github.com/temporalio/sdk-typescript/releases/tag/v1.23.0) —
  experimental Bun 1.4 fixes and protobufjs v8 breaking changes.
- [Bun 1.4 compatibility change](https://github.com/temporalio/sdk-typescript/pull/2349) —
  VM, microtask, shutdown, CI, and stack-trace-query limitations.

## Operations and security

- [TypeScript observability](https://docs.temporal.io/develop/typescript/platform/observability) —
  logs, metrics, tracing, Sinks.
- [Monitor Temporal Cloud](https://docs.temporal.io/cloud/monitor) — Service,
  SDK, and audit signal boundaries.
- [Monitor Worker health](https://docs.temporal.io/cloud/worker-health) — queue,
  poller, slot, and cache signals.
- [Payload encryption](https://docs.temporal.io/production-deployment/data-encryption) —
  codecs, failure conversion, Codec Server security.
- [Temporal Cloud security](https://docs.temporal.io/cloud/security) — execution
  boundary, identity, transport, and payload encryption responsibilities.
- [Self-hosted production checklist](https://docs.temporal.io/self-hosted-guide/production-checklist) —
  persistence, scale, HA, security, and load proof.
- [Server upgrade procedure](https://docs.temporal.io/self-hosted-guide/upgrade-server) —
  schema-first sequential upgrades and staging/load validation.

## Dated feature/runtime notes

| Area | Status at review | Required behavior |
|---|---|---|
| Authentic Node Worker | Node 20/22/24 officially supported | Default generic TypeScript Worker baseline. |
| Bun Worker | 1.23.0 compatibility fixes labeled experimental; upstream still discourages non-Node Workers | Repository's Bun 1.4/SDK 1.22 path is a tested exception; revalidate every upgrade. |
| Worker Deployments | GA in Server 1.31 | Use current model; check Server/Cloud/SDK minimums and installed options. |
| Legacy Version Sets / Assignment Rules | Sunset in Server 1.31; scheduled for removal in 1.32 | Do not teach for new deployments; recheck after 1.32 ships. |
| Priority and Fairness | GA in Server 1.31; Cloud Fairness has enablement/entitlement constraints | Recheck product scope; never assume global FIFO. |
| External Storage | Pre-release in TypeScript docs | Do not recommend as a transparent default; verify lifecycle, drivers, encryption ordering. |
| Standalone Activities | Public Preview in reviewed docs/Server release | Version- and flag-gate; all management operations are live mutations. |

## Upstream skill provenance

The official Temporal developer skill was audited as an input, not copied
wholesale:

- Repository: [temporalio/skill-temporal-developer](https://github.com/temporalio/skill-temporal-developer)
- Audited commit: [`5de78ea2a3775abfc0802926ead357afb53f2258`](https://github.com/temporalio/skill-temporal-developer/commit/5de78ea2a3775abfc0802926ead357afb53f2258)
- License: [MIT at the audited commit](https://github.com/temporalio/skill-temporal-developer/blob/5de78ea2a3775abfc0802926ead357afb53f2258/LICENSE)

The local skill independently corrects failure wrapping/idempotency, current
Worker Versioning, feature stages, typed Search Attributes, Node/Bun support,
repository type/fail-fast rules, and live-operation authorization. Exact
provenance and retained license text live in the repository's public-skill
provenance system.
