#set page(margin: (x: 2cm, y: 2cm), numbering: "1", paper: "a4")
#set text(font: "New Computer Modern", size: 10pt)
#set par(justify: true, leading: 0.65em)
#set heading(numbering: "1.1")
#show link: it => text(fill: rgb("#2563eb"), it)
#show heading.where(level: 1): set text(size: 14pt)
#show heading.where(level: 2): set text(size: 12pt)

#import "@preview/gentle-clues:1.3.1": *
#import "@preview/fletcher:0.5.8": diagram, node, edge

// Title
#align(center)[
  #text(size: 20pt, weight: "bold")[Temporal Migration Plan]
  #v(0.3em)
  #text(size: 11pt, fill: gray)[Consolidating workflow-like code under Temporal]
  #v(0.3em)
  #text(size: 10pt, fill: gray)[April 2026]
]

#v(1em)

= Context

The monorepo has a Temporal server deployed on Kubernetes (v1.29.5, PostgreSQL backend) but *zero workflows or workers*. Multiple packages implement ad-hoc workflow patterns: custom job queues, cron schedulers, orchestration primitives, and K8s CronJobs. This plan consolidates them under Temporal for durability, observability, and unified scheduling.

#warning[
  *Bun Compatibility:* The Temporal TypeScript SDK worker uses a native Rust core and Node.js `vm` for workflow sandboxing. *Bun does not support this.* The worker must run under Node.js. Activities are Bun-compatible. `\@temporalio/client` works under Bun for triggering workflows.
]

= Architecture Overview

#align(center)[
  #diagram(
    spacing: (2cm, 1.5cm),
    node-stroke: 0.8pt,
    node-corner-radius: 4pt,
    node((0, 0), [*HA Event Bridge*\ `\@digital-alchemy/hass`], name: <ha>, fill: rgb("#dbeafe")),
    node((1, 0), [*Scout Backend*\ Discord.js + Prisma], name: <scout>, fill: rgb("#dbeafe")),
    node((2, 0), [*Sentinel Webhooks*\ Hono HTTP], name: <sentinel>, fill: rgb("#dbeafe")),
    node((1, 1), [*Temporal Server*\ gRPC :7233], name: <server>, fill: rgb("#fef3c7"), stroke: 1.2pt),
    node((0, 2), [*Main Worker*\ Node.js], name: <worker>, fill: rgb("#dcfce7")),
    node((2, 2), [*Scout Worker*\ Node.js], name: <sworker>, fill: rgb("#dcfce7")),
    node((0, 3), [Home Assistant\ REST API], name: <hapi>, fill: rgb("#f3e8ff")),
    node((1, 3), [External APIs\ GitHub, Anthropic,\ Postal, Firebase], name: <ext>, fill: rgb("#f3e8ff")),
    node((2, 3), [Scout DB\ Prisma + Discord], name: <sdb>, fill: rgb("#f3e8ff")),
    edge(<ha>, <server>, "->", [start\ workflow]),
    edge(<scout>, <server>, "->"),
    edge(<sentinel>, <server>, "->"),
    edge(<server>, <worker>, "->", [dispatch]),
    edge(<server>, <sworker>, "->", [dispatch]),
    edge(<worker>, <hapi>, "->"),
    edge(<worker>, <ext>, "->"),
    edge(<sworker>, <sdb>, "->"),
  )
]

= Package Structure

New package: `packages/temporal/`

#table(
  columns: (auto, 1fr),
  table.header([*Path*], [*Purpose*]),
  [`src/worker.ts`], [Worker entrypoint (Node.js runtime)],
  [`src/client.ts`], [Shared Temporal client factory],
  [`src/shared/task-queues.ts`], [Task queue name constants (`default`, `scout`)],
  [`src/shared/schemas.ts`], [Zod schemas for all workflow inputs],
  [`src/workflows/{domain}/`], [Workflow definitions per domain],
  [`src/activities/{domain}/`], [Activity implementations per domain],
  [`src/schedules/register-schedules.ts`], [Creates/updates all Temporal schedules on startup],
  [`Dockerfile`], [Node.js base image],
)

= Migration Candidates

#table(
  columns: (auto, auto, auto, auto, auto),
  table.header([*Candidate*], [*Current*], [*Phase*], [*Schedule*], [*Migrate?*]),
  [HA Automations], [Long-running service], [2], [Events + cron], [Yes],
  [BSC Fetcher], [K8s CronJob], [1], [Every 15min], [Yes],
  [Deps Summary], [K8s CronJob], [1], [Monday 9 AM], [Yes],
  [Sentinel], [SQLite queue], [4], [Cron + webhooks], [Yes],
  [Scout (6 jobs)], [In-process cron], [3], [15min -- weekly], [Yes],
  [Scout (2 jobs)], [In-process cron], [---], [30s / 1min], [*No* (too frequent)],
  [Bugsink], [K8s CronJob], [---], [Daily 3 AM], [*No* (Python env)],
  [Golink Sync], [ArgoCD hook], [---], [On sync], [*No* (sidecar)],
  [Toolkit Daemon], [File watcher], [---], [Continuous], [*No* (reactive)],
)

= Phased Plan

== Phase 0: Foundation

Create the `packages/temporal/` package, Dockerfile, and K8s resources.

#table(
  columns: (1fr, 1fr),
  table.header([*Create*], [*Modify*]),
  [`packages/temporal/package.json`\ `packages/temporal/tsconfig.json`\ `packages/temporal/Dockerfile`\ `packages/temporal/src/worker.ts`\ `packages/temporal/src/client.ts`\ `packages/temporal/src/shared/*`],
  [`homelab/.../temporal/worker.ts` (new cdk8s)\ `homelab/.../cdk8s-charts/temporal.ts`\ `homelab/.../versions.ts`\ Temporal NetworkPolicy (add worker egress)\ CI pipeline (add Docker build)],
)

*Verify:* Worker starts, connects to Temporal server, visible in Temporal UI.

== Phase 1: Simple Batch Pipelines

*1a. Better Skill Capped Fetcher* --- Firebase Firestore #sym.arrow.r fetch JSON #sym.arrow.r S3 upload

- 3 activities: `getFirestoreManifestUrl`, `fetchManifestJson`, `uploadToS3`
- Schedule: `*/15 * * * *`
- Remove K8s CronJob manifest

*1b. Dependency Summary Email* --- Clone repo #sym.arrow.r parse diffs #sym.arrow.r fetch notes #sym.arrow.r LLM summarize #sym.arrow.r email

- 4 activities: `cloneAndGetVersionChanges`, `fetchReleaseNotes`, `summarizeWithLLM`, `formatAndSendEmail`
- Schedule: `0 9 * * MON`

== Phase 2: Home Assistant Automations

The most architecturally interesting migration. Six workflows, each mapping current orchestration primitives to Temporal patterns:

#table(
  columns: (1fr, 1fr),
  table.header([*Current Pattern*], [*Temporal Equivalent*]),
  [`runParallel([...])`], [`Promise.all([activity1(), activity2()])`],
  [`runSequentialWithDelay([...], d)`], [`await act(); await sleep(d); await act()`],
  [`withTimeout(promise, dur)`], [Activity `scheduleToCloseTimeout`],
  [`verifyAfterDelay(entity, expected)`], [`sleep(delay)` + retry loop with `getEntityState`],
  [`wait(time)`], [`await sleep(duration)` --- durable timer],
  [`runIf(cond, fn)`], [Normal `if` in workflow code],
)

*Event bridge:* Slim `\@homelab/ha` to WebSocket event listener + `\@temporalio/client`. On person state change or time trigger, start the appropriate Temporal workflow. All orchestration moves to Temporal.

*Activities:* Replace `\@digital-alchemy/hass` calls with direct HA REST API: `callHassService`, `getEntityState`, `sendNotification`.

== Phase 3: Scout for LoL (Partial)

Migrate 6 infrequent cron jobs. Scout backend runs its own Temporal worker on `scout` task queue (needs Prisma + Discord.js access).

*Keep as in-process cron:* Pre-match (30s), post-match (1min) --- Temporal overhead disproportionate.

== Phase 4: Sentinel

Sentinel's architecture maps 1:1 to Temporal:

#table(
  columns: (1fr, 1fr),
  table.header([*Sentinel Concept*], [*Temporal Replacement*]),
  [SQLite job queue (Prisma)], [Temporal task queue],
  [Worker poll loop], [Temporal worker],
  [Cron adapter], [Temporal schedules],
  [Webhook adapter], [Workflow start from Hono handler],
  [Job timeout + retry], [Workflow timeout + retry policy],
  [Discord approval queue], [Temporal signals],
)

*Discord approval flow:* Workflow sends Discord message (activity), waits on `approvalReceived` signal via `workflow.condition()`. Discord bot calls `workflowHandle.signal()`.

*Agent heartbeats:* `runAgentQuery` activity heartbeats on each Claude SDK streaming event to avoid activity timeout during long agent runs.

== Phase 5: Cleanup \& Observability

- Remove custom `instrumentWorkflow` from HA
- Configure Temporal SDK Prometheus metrics export
- Grafana dashboards for workflow execution
- Alert on workflow failures
- Remove replaced K8s CronJob manifests

= Risks

#table(
  columns: (auto, 1fr, 1fr),
  table.header([*Risk*], [*Impact*], [*Mitigation*]),
  [Bun incompatibility], [Worker must use Node.js], [Activities adaptable; client works in Bun],
  [HA REST API typing], [Lose type-safe entity IDs], [Zod schemas for entity IDs],
  [Long agent activities], [Timeout kills agent mid-run], [Heartbeat on streaming events],
  [Single point of failure], [Temporal down = all stop], [PostgreSQL-backed; accept dependency],
  [Migration rollback], [Broken automation], [Run old + new in parallel per phase],
)

= Verification Checklist

+ Workflows visible in Temporal UI with correct schedules
+ Manual workflow execution produces expected results
+ Metrics flowing to Prometheus
+ No regressions in existing functionality
+ Removed CronJobs no longer appear in K8s
