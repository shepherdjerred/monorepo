---
id: architecture-2026-06-06-temporal-worker-and-scheduler
type: architecture
status: complete
board: false
---

# Temporal Worker & Agent-Task Scheduler

A single Bun process that runs the monorepo's Temporal worker fleet — durable scheduled jobs (replacing K8s CronJobs), Home Assistant automations, a GitHub webhook for merge-conflict checks + PR-closed build cancellation, and a generic report-only "agent task" scheduler with an authenticated HTTP API.

## Purpose & role

`packages/temporal` consolidates ad-hoc scheduling (CronJobs, in-process cron, custom queues) under Temporal for durability, observability, and a single UI. It runs under **Bun** (`packages/temporal/src/worker.ts` is the entrypoint; `bun run start`). Workflows are deterministic and do no I/O; activities do the real work (HTTP, DB, `Bun.spawn` subprocesses, file I/O). See `packages/temporal/CLAUDE.md` for env vars and the HA-schema codegen story.

## Worker topology

`main()` in `packages/temporal/src/worker.ts` connects to the Temporal server (`TEMPORAL_ADDRESS`, default `temporal-server.temporal.svc.cluster.local:7233`, namespace `default`) and creates **four workers**, all sharing the same workflow bundle (`workflows/index.ts`) and the same activity surface (`activities/index.ts`), one per task queue (`packages/temporal/src/shared/task-queues.ts`):

| Task queue (`TASK_QUEUES`) | Value             | Why isolated                                                   |
| -------------------------- | ----------------- | -------------------------------------------------------------- |
| `DEFAULT`                  | `default`         | HA automations, cron jobs, fast workflows                      |
| `AGENT_TASK`               | `agent-task`      | long-running Claude/Codex report-only subprocesses             |
| `GLITTER_CORPUS`           | `glitter-corpus`  | rate-limited Discord corpus capture (one activity at a time)   |
| `GLITTER_CONTEXT`          | `glitter-context` | weekly Sol context generation, isolated from the capture queue |

Workflows are registered the Temporal way: every workflow is a wrapper function exported from the single entrypoint `packages/temporal/src/workflows/index.ts` (delegating to per-file impls to satisfy a no-re-export lint rule); `Worker.create({ workflowsPath })` webpacks that file. `bundle.test.ts` runs the same webpack pass as a smoke test. Activities are aggregated in `packages/temporal/src/activities/index.ts` and passed to every worker.

Boot sequence after workers are created: install Temporal SDK runtime + Prometheus metrics bridge, init Sentry (`@sentry/bun`) and OTel tracing, start the app metrics server, then `registerSchedules(client)` → `startHttpServers(client)` → `startEventBridgeSupervisor(client)`, finally `Promise.all` of all four `worker.run()`s. Shutdown is SIGTERM/SIGINT-guarded against double-drain.

## Major workflow families

- **Agent tasks** — `agentTaskWorkflow` (`packages/temporal/src/workflows/agent-task.ts`) on `AGENT_TASK`. The generic report-only runner; see below.
- **Homelab audit** — `homelab-audit-daily` (cron `30 6 * * *` PT) runs **through** `agentTaskWorkflow` with a baked-in `HOMELAB_AUDIT_AGENT_TASK` input (`register-schedules.ts`), not a bespoke workflow. The legacy `runHomelabAuditWorkflow` (`workflows/homelab-audit.ts`) remains as a rollback path. Activity: `Bun.spawn` `claude -p`, 10 s heartbeats, stderr redaction, Postal email.
- **GitHub webhook (merge-conflict + PR-closed)** — the whole in-repo PR review / summary / reaction-listener / babysit bot was **removed** (it was gated off in production). What remains of `event-bridge/github-webhook.ts` starts `checkPrMergeConflictsWorkflow` on `push`-to-main + `pull_request` events (posts the `ci/merge-conflict` status) and `cancelBuildkiteBuildsWorkflow` on `pull_request` `closed`. No LLM, no comment posting.
- **Durable review-signal collector** — `observeReviewSignalsWorkflow` (`review-signals-collect`, cron every 6 h, `DEFAULT`) records the CI review gate's provider-neutral signals as `review_*` metrics + S3 NDJSON. Independent of the removed bot.
- **Home Assistant** — `goodMorningWakeUp`/`goodMorningGetUp`, `runVacuumIfNotHome` (×3 cron times), plus event-driven `welcomeHome`/`leavingHome`/`reconcileLock` (presence debounce model documented in `packages/temporal/CLAUDE.md`).
- **Scout / LoL** — `runScoutDataDragonVersionCheck`, `runScoutDataDragonWeeklyRefresh`, `runScoutSeasonRefreshWorkflow` (claude `-p` → PR on drift).
- **Maintenance / misc** — `runZfsMaintenanceWorkflow`, `runVeleroOrphanAuditWorkflow` (emits orphan-snapshot Prom metrics), `runBugsinkHousekeepingWorkflow`, `runDnsAudit`, `generateDependencySummary`, `fetchSkillCappedManifest`, `syncGolinks`, `cancelBuildkiteBuildsWorkflow` (triggered on PR close).

## Schedules

`registerSchedules(client)` (`packages/temporal/src/schedules/register-schedules.ts`) runs on every worker startup and is the single source of truth for cron schedules. It:

1. Deletes any schedule ID in the explicit `DELETED_SCHEDULE_IDS` allow-list (a blind "prune anything not in `SCHEDULES`" would wipe the ad-hoc agent-task schedules created via the API).
2. For each entry in the `SCHEDULES` array: `handle.update(...)` if it exists, else `create(...)` (catching `ScheduleNotFoundError`). All crons are `America/Los_Angeles` wall-clock; overlap policy is `SKIP`. `update(...)` spreads the previous schedule, so a live pause set in the Temporal UI is preserved across restarts.

Each `ScheduleDefinition` carries `id`, `workflowType` (must match an `index.ts` export), `args`, `cronExpression`, `taskQueue`, `overlap`, optional `workflowExecutionTimeout`, and a `memo`. Notable IDs: `fetcher-skill-capped`, `deps-summary-weekly`, `dns-audit-daily`, `homelab-audit-daily`, `scout-data-dragon-version-check`, `zfs-maintenance-weekly`, `velero-orphan-audit`, `golink-sync`, `vacuum-{9am,12pm,5pm}`, `good-morning-week{day,end}-{wake,up}`.

## Agent-task scheduler, report-only mode & the `/agent-tasks` API

The generic agent-task system lets operators (and agents) schedule **report-only** Claude/Codex runs that inspect read-only state and email a markdown report.

- **Schema** — `AgentTaskInputSchema` (`packages/temporal/src/shared/agent-task.ts`). Required: `title`, `prompt`, `provider` (`claude`|`codex`), `repo.fullName`. `mode` is `report-only` (the only value). Mutually exclusive `runAt` (one-off RFC3339) vs `cron` (recurring, needs/derives a `scheduleId`). Optional `model`, `maxTurns`, `agentTimeoutMinutes` (≤90), `allowSelfCancel`, `emailSubjectPrefix`, `source` (`docPath`/`url`/`note`), `idempotencyKey`.
- **Dispatch** — `startOrScheduleAgentTask` (`packages/temporal/src/lib/agent-task-scheduler.ts`): `cron` → upsert a Temporal Schedule (id from `agentTaskScheduleId`); otherwise → `workflow.start("agentTaskWorkflow")` with a content-hash `workflowId` and `REJECT_DUPLICATE`/`FAIL` policies for idempotency.
- **Workflow** — `agentTaskWorkflow` (`workflows/agent-task.ts`): `waitUntilRunAt` (sleeps to `runAt`) → `prepareAgentTaskWorkdir` (clones repo) → `runAgentTask` (subprocess; activity timeout = `agentTimeoutMinutes ?? 90` min, 60 s heartbeat, single attempt when bounded) → `sendAgentTaskEmail` (Postal) → `dispatchFollowUp`, with workdir cleanup in `finally`. The agent returns JSON (`AgentTaskResultPayloadSchema`: `markdown` + optional `followUp`, `cancelCron`, `cancelReason`). A `followUp` schedules one more report-only task; `cancelCron: true` is honored **only** when `allowSelfCancel` is set and **pauses** (never deletes) the owning schedule.
- **Report-only enforcement** — `reportOnlyPrompt` (`shared/agent-task.ts`) prepends hard constraints: no edits/commits/PRs/issues, no mutating live systems, read-only inspection only.
- **HTTP API** — `startAgentTaskApi` (`packages/temporal/src/event-bridge/agent-task-api.ts`) serves `POST /agent-tasks` on port `9467` (`AGENT_TASK_API_PORT`). Requires `Authorization: Bearer $AGENT_TASK_API_TOKEN` (constant-time compare), Zod-validates the body, returns `202` with the start result. This is the **only** public ingress path for scheduling — direct Temporal access is not exposed publicly.
- **Operator/doc path** — the `temporal-agent-task` convention: docs embed a `<!-- temporal-agent-task … -->` HTML-comment block containing the JSON input. `packages/temporal/scripts/schedule-agent-task.ts --from-doc <path>` extracts that block, validates it, and calls `startOrScheduleAgentTask`. Also supports `--json` / `--stdin`. The root and `packages/docs/AGENTS.md` reference this for scheduling temporal follow-ups.

## Event bridge

`startEventBridge` / `startHttpServers` (`packages/temporal/src/event-bridge/index.ts`):

- **HA events** — connects to Home Assistant via `@shepherdjerred/home-assistant`, subscribes to `ios.action_fired` and `state_changed`, routed by `triggers.ts` (presence transitions → `signalWithStart("reconcileLock")`). Supervised with exponential-backoff reconnect in `worker.ts`; `HA_URL`/`HA_TOKEN` required.
- **GitHub webhook** — `startGithubWebhook` (`packages/temporal/src/event-bridge/github-webhook.ts`), Hono server on port `9466` (`GITHUB_WEBHOOK_PORT`), **only started when `GITHUB_WEBHOOK_SECRET` is set**. Verifies `X-Hub-Signature-256` HMAC, then: `push`-to-main and `pull_request` (`opened`/`synchronize`/`reopened`/`edited`) → `checkPrMergeConflictsWorkflow` (posts `ci/merge-conflict`); `pull_request` `closed` → `cancelBuildkiteBuildsWorkflow`. The PR review/summary/reaction-listener/babysit bot that formerly also ran here was removed — no LLM, no comment posting.
- **Agent-task API** — always started alongside (`9467`).

## Observability & DB

- **Metrics** — two Prometheus surfaces. (1) The Temporal SDK's built-in bridge on `:9464` (`TEMPORAL_METRICS_ADDRESS`), prefix `temporal_worker_`. (2) An application registry (`packages/temporal/src/observability/metrics.ts`) served at `/metrics` on `:9465` (`APP_METRICS_PORT`) — counters/gauges/histograms for the GitHub webhook + merge-conflict check (`pr_webhook_*`, `pr_merge_conflict_check_*`), the review-signal collector (`review_*`), homelab audit, agent tasks (`agent_task_*`), scout refresh, velero orphans (`velero_orphan_local_snapshots_total`, …), plus `temporal_workflow_outcome_total` to distinguish "executed" from "skipped" for check-and-skip workflows. Default labels include `component=temporal-worker`.
- **Tracing** — OTel → Tempo via `observability/tracing.ts`, gated by `TELEMETRY_ENABLED`/`OTLP_ENDPOINT`. Sentry (`@sentry/bun`) handles errors with `skipOpenTelemetrySetup: true` so it doesn't collide with the OTel SDK.
- **Logging** — structured single-line JSON via `jsonLog` helpers; filter by `component` (`temporal-worker`, `pr-webhook`, `agent-task-api`, `ha-presence`, etc.).
- **DB** — the worker owns no relational database of its own. Workflows persist to S3/SeaweedFS or external APIs. (The Temporal server's own Postgres is provisioned separately in `packages/homelab`.)
