# Temporal Worker & Agent-Task Scheduler

A single Bun process that runs the monorepo's Temporal worker fleet — durable scheduled jobs (replacing K8s CronJobs), Home Assistant automations, the PR review/summary bot, and a generic report-only "agent task" scheduler with an authenticated HTTP API.

## Purpose & role

`packages/temporal` consolidates ad-hoc scheduling (CronJobs, in-process cron, custom queues) under Temporal for durability, observability, and a single UI. It runs under **Bun** (`packages/temporal/src/worker.ts` is the entrypoint; `bun run start`). Workflows are deterministic and do no I/O; activities do the real work (HTTP, DB, `Bun.spawn` subprocesses, file I/O). See `packages/temporal/CLAUDE.md` for env vars and the HA-schema codegen story.

## Worker topology

`main()` in `packages/temporal/src/worker.ts` connects to the Temporal server (`TEMPORAL_ADDRESS`, default `temporal-server.temporal.svc.cluster.local:7233`, namespace `default`) and creates **four workers**, all sharing the same workflow bundle (`workflows/index.ts`) and the same activity surface (`activities/index.ts`), one per task queue (`packages/temporal/src/shared/task-queues.ts`):

| Task queue (`TASK_QUEUES`) | Value        | Why isolated                                                                                                                              |
| -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT`                  | `default`    | HA automations, cron jobs, fast workflows                                                                                                 |
| `PR_REVIEW`                | `pr-review`  | slow multi-specialist LLM activities; `maxConcurrentActivityTaskExecutions` from `PR_REVIEW_WORKER_MAX_CONCURRENT_ACTIVITIES` (default 1) |
| `PR_SUMMARY`               | `pr-summary` | cheap Haiku summary, isolated so a stuck specialist can't block it                                                                        |
| `AGENT_TASK`               | `agent-task` | long-running Claude/Codex report-only subprocesses                                                                                        |

Workflows are registered the Temporal way: every workflow is a wrapper function exported from the single entrypoint `packages/temporal/src/workflows/index.ts` (delegating to per-file impls to satisfy a no-re-export lint rule); `Worker.create({ workflowsPath })` webpacks that file. `bundle.test.ts` runs the same webpack pass as a smoke test. Activities are aggregated in `packages/temporal/src/activities/index.ts` and passed to every worker.

Boot sequence after workers are created: install Temporal SDK runtime + Prometheus metrics bridge, init Sentry (`@sentry/bun`) and OTel tracing, start the app metrics server, then `registerSchedules(client)` → `startPrReactionListener(client)` → `startHttpServers(client)` → `startEventBridgeSupervisor(client)`, finally `Promise.all` of all four `worker.run()`s. Shutdown is SIGTERM/SIGINT-guarded against double-drain.

## Major workflow families

- **Agent tasks** — `agentTaskWorkflow` (`packages/temporal/src/workflows/agent-task.ts`) on `AGENT_TASK`. The generic report-only runner; see below.
- **Homelab audit** — `homelab-audit-daily` (cron `30 6 * * *` PT) runs **through** `agentTaskWorkflow` with a baked-in `HOMELAB_AUDIT_AGENT_TASK` input (`register-schedules.ts`), not a bespoke workflow. The legacy `runHomelabAuditWorkflow` (`workflows/homelab-audit.ts`) remains as a rollback path. Activity: `Bun.spawn` `claude -p`, 10 s heartbeats, stderr redaction, Postal email.
- **PR review / summary bot** — `prReviewPipeline` (`PR_REVIEW`, multi-specialist consensus + empirical verification, `workflows/pr-review/index.ts`) and `prSummaryPipeline` (`PR_SUMMARY`, Anthropic-SDK Haiku 4.5, `workflows/pr-summary/index.ts`). Started from the webhook (see event-bridge). **Note: the PR bot is gated off via `PR_BOT_ENABLED=false` as of 2026-06-06** — the webhook still acks 200 but starts no workflow and posts no comment. (Re-enable + rate-limit fix tracked in `packages/docs/todos/pr-review-agent-rate-limit-saturation.md`.)
- **PR review eval** — `prReviewEvalWorkflow` (`pr-review-eval-nightly`, cron `0 4 * * *`) replays a fixture corpus, persists precision/recall to the `pr_review_eval` Postgres DB, and alerts on regression; `prReviewWeeklySignificanceWorkflow` (`pr-review-ab-weekly-report`, Mon `0 9 * * 1`) posts a Bayesian A/B report to Discord. Both pause themselves when `PR_REVIEW_FIXTURES_REPO_URL` / `PR_REVIEW_EVAL_DATABASE_URL` are unset.
- **PR reaction listener** — long-running `prReactionListener` workflow, started idempotently at boot via `startPrReactionListener` (`event-bridge/start-pr-reaction-listener.ts`); self-recycles via continue-as-new ~every 24 h.
- **Alert remediation** — `alertRemediationSweepWorkflow` (`alert-remediation-hourly`, cron `0 * * * *`, `AGENT_TASK` queue) fans out PagerDuty/Bugsink alerts to `alertRemediationChildWorkflow` children (`executeChild`, bounded per-agent timeout); children may open **draft** PRs for straightforward repo-only fixes.
- **Home Assistant** — `goodMorningWakeUp`/`goodMorningGetUp`, `runVacuumIfNotHome` (×3 cron times), plus event-driven `welcomeHome`/`leavingHome`/`reconcileLock` (presence debounce model documented in `packages/temporal/CLAUDE.md`).
- **Scout / LoL** — `runScoutDataDragonVersionCheck`, `runScoutDataDragonWeeklyRefresh`, `runScoutSeasonRefreshWorkflow` (claude `-p` → PR on drift).
- **Maintenance / misc** — `runZfsMaintenanceWorkflow`, `runVeleroOrphanAuditWorkflow` (emits orphan-snapshot Prom metrics), `runBugsinkHousekeepingWorkflow`, `runDnsAudit`, `generateDependencySummary`, `fetchSkillCappedManifest`, `syncGolinks`, `runPokeemeraldWasmUpdate`, `cancelBuildkiteBuildsWorkflow` (triggered on PR close).

## Schedules

`registerSchedules(client)` (`packages/temporal/src/schedules/register-schedules.ts`) runs on every worker startup and is the single source of truth for cron schedules. It:

1. Deletes any schedule ID in the explicit `DELETED_SCHEDULE_IDS` allow-list (a blind "prune anything not in `SCHEDULES`" would wipe the ad-hoc agent-task schedules created via the API).
2. For each entry in the `SCHEDULES` array: `handle.update(...)` if it exists, else `create(...)` (catching `ScheduleNotFoundError`). All crons are `America/Los_Angeles` wall-clock; overlap policy is `SKIP`.
3. Reconciles pause state via `reconcileSchedulePauseState` — the two PR-review-eval schedules pause/unpause based on env presence.

Each `ScheduleDefinition` carries `id`, `workflowType` (must match an `index.ts` export), `args`, `cronExpression`, `taskQueue`, `overlap`, optional `workflowExecutionTimeout`, and a `memo`. Notable IDs: `fetcher-skill-capped`, `deps-summary-weekly`, `dns-audit-daily`, `homelab-audit-daily`, `alert-remediation-hourly`, `scout-data-dragon-version-check`, `pokeemerald-wasm-monthly`, `zfs-maintenance-weekly`, `velero-orphan-audit`, `golink-sync`, `vacuum-{9am,12pm,5pm}`, `good-morning-week{day,end}-{wake,up}`, plus the two `pr-review-*` eval schedules.

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
- **GitHub webhook** — `startGithubWebhook` (`packages/temporal/src/event-bridge/github-webhook.ts`), Hono server on port `9466` (`GITHUB_WEBHOOK_PORT`), **only started when `GITHUB_WEBHOOK_SECRET` is set**. Verifies `X-Hub-Signature-256` HMAC, parses the `pull_request` event (Zod), and for relevant actions (`opened`/`synchronize`/`reopened`/`ready_for_review`) starts the review + summary pipelines in parallel (`REJECT_DUPLICATE` per commit sha). Skips drafts, bot authors, and closed PRs (closed → `cancelBuildkiteBuildsWorkflow`). **`PR_BOT_ENABLED` is the master kill switch** read per-request (default `true`; currently `false`) — when off, the webhook acks 200 but starts no workflow and posts no status.
- **Agent-task API** — always started alongside (`9467`).

## Observability & DB

- **Metrics** — two Prometheus surfaces. (1) The Temporal SDK's built-in bridge on `:9464` (`TEMPORAL_METRICS_ADDRESS`), prefix `temporal_worker_`. (2) An application registry (`packages/temporal/src/observability/metrics.ts`) served at `/metrics` on `:9465` (`APP_METRICS_PORT`) — counters/gauges/histograms for the PR bot (`pr_webhook_*`, `pr_summary_*`, `pr_review_*`, `ai_provider_*`), homelab audit, agent tasks (`agent_task_*`), scout refresh, velero orphans (`velero_orphan_local_snapshots_total`, …), plus `temporal_workflow_outcome_total` to distinguish "executed" from "skipped" for check-and-skip workflows. Default labels include `component=temporal-worker`.
- **Tracing** — OTel → Tempo via `observability/tracing.ts`, gated by `TELEMETRY_ENABLED`/`OTLP_ENDPOINT`. Sentry (`@sentry/bun`) handles errors with `skipOpenTelemetrySetup: true` so it doesn't collide with the OTel SDK.
- **Logging** — structured single-line JSON via `jsonLog` helpers; filter by `component` (`temporal-worker`, `pr-webhook`/`pr-agent`/`pr-summary`, `agent-task-api`, `ha-presence`, etc.).
- **DB** — the only relational DB is `pr_review_eval` (Postgres), accessed through `Bun.SQL`. A hand-rolled, checksum-guarded migration runner (`packages/temporal/src/db/migrate.ts`) applies `migrations/pr-review-eval/*.sql` in lex order, recording each in a `_migrations` ledger; re-applying a changed file is refused. Other workflows persist to S3/SeaweedFS or external APIs, not a local DB.
