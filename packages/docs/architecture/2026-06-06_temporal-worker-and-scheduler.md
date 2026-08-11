---
id: architecture-2026-06-06-temporal-worker-and-scheduler
type: architecture
status: complete
board: false
---

# Temporal Worker & Agent-Task Scheduler

A Bun worker fleet that runs durable scheduled jobs (replacing K8s CronJobs), Home Assistant automations, a GitHub webhook for merge-conflict checks + PR-closed build cancellation, and a generic report-only "agent task" scheduler with an authenticated HTTP API.

## Purpose & role

`packages/temporal` consolidates ad-hoc scheduling (CronJobs, in-process cron, custom queues) under Temporal for durability, observability, and a single UI. It runs under **Bun** (`packages/temporal/src/worker.ts` is the entrypoint; `bun run start`). Workflows are deterministic and do no I/O; activities do the real work (HTTP, DB, `Bun.spawn` subprocesses, file I/O). See `packages/temporal/CLAUDE.md` for env vars and the HA-schema codegen story.

## Worker topology

`main()` in `packages/temporal/src/worker.ts` connects to the Temporal server (`TEMPORAL_ADDRESS`, default `temporal-server.temporal.svc.cluster.local:7233`, namespace `default`) and creates **five workers across four production Deployments**, all sharing the same workflow bundle (`workflows/index.ts`) and the role-appropriate activity surface, one per active task queue (`packages/temporal/src/shared/task-queues.ts`):

| Task queue (`TASK_QUEUES`) | Value             | Why isolated                                                   |
| -------------------------- | ----------------- | -------------------------------------------------------------- |
| `DEFAULT`                  | `default`         | HA automations, cron jobs, fast workflows                      |
| `MAINTENANCE`              | `maintenance`     | serial direct subprocess work against Buildkite PVCs           |
| `AGENT_TASK`               | `agent-task`      | long-running Claude/Codex report-only subprocesses             |
| `GLITTER_CORPUS`           | `glitter-corpus`  | rate-limited Discord corpus capture (one activity at a time)   |
| `GLITTER_CONTEXT`          | `glitter-context` | weekly Sol context generation, isolated from the capture queue |

Workflows are registered the Temporal way: every workflow is a wrapper function exported from the single entrypoint `packages/temporal/src/workflows/index.ts` (delegating to per-file impls to satisfy a no-re-export lint rule); `Worker.create({ workflowsPath })` webpacks that file. `bundle.test.ts` runs the same webpack pass as a smoke test. Activities are aggregated in `packages/temporal/src/activities/index.ts` and passed to every worker.

The `core` Deployment owns `DEFAULT`, schedule registration, HTTP services, and the event bridge. The `agent` Deployment owns only `AGENT_TASK` and runs as `temporal-agent-worker`; its service account receives the read-only audit ClusterRole but none of the namespace-scoped pod-exec roles used by deterministic workflows. The poller runs as capability-minimal root (`SETUID` only), launches provider commands as uid 1001 through `setpriv`, and installs a pod-local owner firewall before startup that blocks the provider uid from Temporal gRPC/UI ports and their Tailscale ingress addresses. This is the active network control on the current Flannel cluster; the separate agent `NetworkPolicy` is future-CNI intent, not claimed enforcement. The `glitter` Deployment owns both Glitter queues. A tokenless `maintenance` Deployment in the Buildkite namespace owns `MAINTENANCE`. Each process installs the SDK metrics bridge, Sentry, OTel, and app metrics before polling its assigned queues. Shutdown is SIGTERM/SIGINT-guarded against double-drain.

## Major workflow families

- **Agent tasks** — `agentTaskWorkflow` (`packages/temporal/src/workflows/agent-task.ts`) on `AGENT_TASK`. The generic report-only runner; see below.
- **Homelab audit** — `homelab-audit-daily` (cron `30 6 * * *` PT) runs `runHomelabAuditWorkflow`. Six typed collectors own status: Prometheus alerts, durable alert occurrences, Temporal failures/stalls, Kubernetes workload health, semantic ArgoCD state, and Buildkite main failures with failed-job logs. A model may only synthesize the collected JSON in at most 80 words. Temporal versioning routes old histories through the legacy implementation, whose undeclared result is reported as partial.
- **GitHub webhook (merge-conflict + PR-closed)** — the whole in-repo PR review / summary / reaction-listener / babysit bot was **removed** (it was gated off in production). What remains of `event-bridge/github-webhook.ts` starts `checkPrMergeConflictsWorkflow` on `push`-to-main + `pull_request` events (posts the `ci/merge-conflict` status) and `cancelBuildkiteBuildsWorkflow` on `pull_request` `closed`. No LLM, no comment posting.
- **Durable review-signal collector** — `observeReviewSignalsWorkflow` (`review-signals-collect`, cron every 6 h, `DEFAULT`) records the CI review gate's provider-neutral signals as `review_*` metrics + S3 NDJSON. Independent of the removed bot.
- **Home Assistant** — `goodMorningWakeUp`/`goodMorningGetUp`, `runVacuumIfNotHome` (×3 cron times), plus event-driven `welcomeHome`/`leavingHome`/`reconcileLock` (presence debounce model documented in `packages/temporal/CLAUDE.md`).
- **Scout / LoL** — `runScoutDataDragonVersionCheck`, `runScoutDataDragonWeeklyRefresh`, `runScoutQueueWindowsWatch`, and `runScoutSeasonRefreshWorkflow`. Each sends a shared-format heartbeat; source/test disagreement in season refresh is partial and cannot open a PR.
- **Maintenance / misc** — `runZfsMaintenanceWorkflow`, `runVeleroOrphanAuditWorkflow` (emits orphan-snapshot Prom metrics), `runBugsinkHousekeepingWorkflow`, `runDnsAudit`, `generateDependencySummary`, `fetchSkillCappedManifest`, `syncGolinks`, `cancelBuildkiteBuildsWorkflow` (triggered on PR close).

## Schedules

`registerSchedules(client)` (`packages/temporal/src/schedules/register-schedules.ts`) runs on every worker startup and is the single source of truth for cron schedules. It:

1. Deletes any schedule ID in the explicit `DELETED_SCHEDULE_IDS` allow-list (a blind "prune anything not in `SCHEDULES`" would wipe the ad-hoc agent-task schedules created via the API).
2. For each entry in the `SCHEDULES` array: `handle.update(...)` if it exists, else `create(...)` (catching `ScheduleNotFoundError`). All crons are `America/Los_Angeles` wall-clock; overlap policy is `SKIP`. `update(...)` spreads the previous schedule, so a live pause set in the Temporal UI is preserved across restarts.

Each `ScheduleDefinition` carries `id`, `workflowType` (must match an `index.ts` export), `args`, `cronExpression`, `taskQueue`, `overlap`, optional `workflowExecutionTimeout`, and a `memo`. Notable IDs: `fetcher-skill-capped`, `deps-summary-weekly`, `dns-audit-daily`, `homelab-audit-daily`, `scout-data-dragon-version-check`, `zfs-maintenance-weekly`, `velero-orphan-audit`, `golink-sync`, `vacuum-{9am,12pm,5pm}`, `good-morning-week{day,end}-{wake,up}`.

## Agent-task scheduler, report-only mode & the `/agent-tasks` API

The generic agent-task system lets operators (and agents) schedule **report-only** Claude/Codex runs that inspect read-only state and email a markdown report.

- **Schema** — new submissions use `AgentTaskInputV2`: `contractVersion: 2`, `title`, `prompt`, `provider` (`claude`|`codex`), `repo.fullName`, and one or more declared `checks` with required/optional status plus an evidence requirement. `mode` is `report-only` (the only value). `runAt` and `cron` are mutually exclusive; recurring inputs use a stable `scheduleId`. The v1 shape remains only for Temporal history replay.
- **Dispatch** — `startOrScheduleAgentTask` (`packages/temporal/src/lib/agent-task-scheduler.ts`): `cron` → upsert a Temporal Schedule (id from `agentTaskScheduleId`); otherwise → `workflow.start("agentTaskWorkflow")` with a content-hash `workflowId`. A future-dated one-off defers **server-side** via `startDelay` (computed from `runAt`) rather than sleeping inside the workflow, with `runAt` stripped from the workflow args (`workflowArgsForOneOff`) so it doesn't double-wait; the bound is `workflowRunTimeout` (per-run, applied only once the run starts — never to the buffered delay) and is calculated from the configured activity timeout, phase count, retry policy, and cleanup overhead. This prevents both a far-future task from timing out before it runs and a two-phase v2 task from being terminated during finalization. Idempotency uses `ALLOW_DUPLICATE_FAILED_ONLY` + `workflowIdConflictPolicy: FAIL` — a previously failed/timed-out run of the same id can be retried by resubmission, while duplicate concurrent or already-succeeded runs are still rejected.
- **Workflow** — `agentTaskWorkflow` (`workflows/agent-task.ts`): server-side delay → workdir clone → investigation subprocess → provider evidence-receipt extraction and redaction → finalization subprocess over that explicit receipt catalog → strict result validation → shared delivery → optional report-only follow-up → cleanup. Finalization cannot use Claude tools, and evidence gathered during finalization is never accepted. Each declared check is normalized independently. Missing, failed, skipped, unknown, or uncaptured evidence forces partial execution. Agents may emit a retirement recommendation, but cannot pause or cancel schedules. A generic failure report is accepted before the workflow rethrows so Temporal still records the failure.
- **Report-only enforcement** — `reportOnlyPrompt` (`shared/agent-task.ts`) prepends hard constraints: no edits/commits/PRs/issues, no mutating live systems, read-only inspection only. The dedicated agent Deployment provides the infrastructure backstop: it has cluster read access for evidence collection but no `pods/exec` RoleBinding, no delivery credentials, and a distinct provider uid denied access to the Temporal frontend and UI by pod-local firewall rules. The deterministic TaskNotes canary stays on the separately authorized core worker, while maintenance runs in its own tokenless Deployment.
- **HTTP API** — `startAgentTaskApi` (`packages/temporal/src/event-bridge/agent-task-api.ts`) serves `POST /agent-tasks` on port `9467` (`AGENT_TASK_API_PORT`). Requires `Authorization: Bearer $AGENT_TASK_API_TOKEN` (constant-time compare), Zod-validates the body, returns `202` with the start result. This is the **only** public ingress path for scheduling — direct Temporal access is not exposed publicly.
- **Operator/doc path** — the `temporal-agent-task` convention: docs embed one or more `<!-- temporal-agent-task … -->` HTML-comment blocks containing JSON inputs. `packages/temporal/scripts/schedule-agent-task.ts --from-doc <path>` extracts and validates every block before connecting, then calls `startOrScheduleAgentTask` for each in document order. It also supports one task through `--json` / `--stdin`. The root and `packages/docs/AGENTS.md` reference this for scheduling temporal follow-ups.

## Shared operational reporting

Every Temporal email producer goes through `ReportEnvelopeV1` and one delivery
activity. Execution (`complete`, `partial`, `failed`) is separate from the
domain verdict. A clear verdict is invalid unless every required check passed
with successful captured evidence. Subjects, HTML, and plain text are derived
deterministically; models may provide only the optional evidence-backed
synthesis.

The sender writes the complete typed report state and Postal acceptance receipt
to S3. A stable report ID, pre-send receipt/state check, and stable headers make
activity retries deduplicate whenever acceptance was persisted. Postal does not
offer a request idempotency key, so a process failure after Postal accepts but
before either S3 write succeeds can still duplicate a message.

`report-freshness-monitor` runs every 15 minutes. It compares the
source-defined report registry with deployed schedules and accepted receipts,
then emits metrics and durable alerts for missing, stale, paused, missing-live,
or unregistered schedules. Grace is 30 minutes for subdaily schedules, two
hours for daily schedules, and six hours for weekly schedules.

## Event bridge

`startEventBridge` / `startHttpServers` (`packages/temporal/src/event-bridge/index.ts`):

- **HA events** — connects to Home Assistant via `@shepherdjerred/home-assistant`, subscribes to `ios.action_fired` and `state_changed`, routed by `triggers.ts` (presence transitions → `signalWithStart("reconcileLock")`). Supervised with exponential-backoff reconnect in `worker.ts`; `HA_URL`/`HA_TOKEN` required.
- **GitHub webhook** — `startGithubWebhook` (`packages/temporal/src/event-bridge/github-webhook.ts`), Hono server on port `9466` (`GITHUB_WEBHOOK_PORT`), **only started when `GITHUB_WEBHOOK_SECRET` is set**. Verifies `X-Hub-Signature-256` HMAC, then: `push`-to-main and `pull_request` (`opened`/`synchronize`/`reopened`/`edited`) → `checkPrMergeConflictsWorkflow` (posts `ci/merge-conflict`); `pull_request` `closed` → `cancelBuildkiteBuildsWorkflow`. The PR review/summary/reaction-listener/babysit bot that formerly also ran here was removed — no LLM, no comment posting.
- **Agent-task API** — always started alongside (`9467`).

## Observability & DB

- **Metrics** — two Prometheus surfaces. (1) The Temporal SDK's built-in bridge on `:9464` (`TEMPORAL_METRICS_ADDRESS`), prefix `temporal_worker_`. (2) An application registry (`packages/temporal/src/observability/metrics.ts`) served at `/metrics` on `:9465` (`APP_METRICS_PORT`) — counters/gauges/histograms for the GitHub webhook + merge-conflict check (`pr_webhook_*`, `pr_merge_conflict_check_*`), the review-signal collector (`review_*`), homelab audit, agent tasks (`agent_task_*`), shared report delivery/freshness, Scout refresh, velero orphans (`velero_orphan_local_snapshots_total`, …), plus `temporal_workflow_outcome_total` to distinguish "executed" from "skipped" for check-and-skip workflows. Default labels include `component=temporal-worker`.
- **Tracing** — OTel → Tempo via `observability/tracing.ts`, gated by `TELEMETRY_ENABLED`/`OTLP_ENDPOINT`. Sentry (`@sentry/bun`) handles errors with `skipOpenTelemetrySetup: true` so it doesn't collide with the OTel SDK.
- **Logging** — structured single-line JSON via `jsonLog` helpers; filter by `component` (`temporal-worker`, `pr-webhook`, `agent-task-api`, `ha-presence`, etc.).
- **DB** — the worker owns no relational database of its own. Workflows persist to S3/SeaweedFS or external APIs. (The Temporal server's own Postgres is provisioned separately in `packages/homelab`.)
