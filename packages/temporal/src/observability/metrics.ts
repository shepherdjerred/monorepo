import {
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  Registry,
} from "prom-client";
import { createStructuredLogger } from "./logging.ts";

const DEFAULT_METRICS_PORT = 9465;

/**
 * Custom Prometheus registry for application-level metrics. Separate from
 * the Temporal SDK's built-in Prometheus bridge (which scrapes on :9464);
 * this one is for metrics emitted by our own activities and workflows.
 */
export const register = new Registry();

register.setDefaultLabels({ component: "temporal-worker" });
collectDefaultMetrics({ register, prefix: "temporal_worker_app_" });

// ---------------------------------------------------------------------------
// GitHub webhook metrics (merge-conflict check + PR-closed build cancel). The
// webhook server is the ingress for those two features; the PR review /
// summary / babysit bots that formerly shared it have been removed.
// ---------------------------------------------------------------------------

export const prWebhookReceivedTotal = new Counter({
  name: "pr_webhook_received_total",
  help: "GitHub webhook deliveries received and accepted (post signature verify), by event type and action",
  labelNames: ["event", "action"] as const,
  registers: [register],
});

export const prWebhookSkippedTotal = new Counter({
  name: "pr_webhook_skipped_total",
  help: "GitHub webhook deliveries skipped without starting a workflow, by reason (non-pull-request-event, push:non-main-ref, schema-parse-failed, etc.)",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const prWebhookSignatureFailuresTotal = new Counter({
  name: "pr_webhook_signature_failures_total",
  help: "GitHub webhook deliveries rejected for missing or invalid X-Hub-Signature-256",
  registers: [register],
});

// ---------------------------------------------------------------------------
// homelab-audit workflow metrics
// ---------------------------------------------------------------------------

export const homelabAuditSubprocessDurationSeconds = new Histogram({
  name: "homelab_audit_subprocess_duration_seconds",
  help: "Wall-clock duration of Codex SDK runs for the homelab daily audit; the metric name is retained for time-series continuity",
  labelNames: ["model", "exit_code"] as const,
  buckets: [60, 300, 600, 900, 1500, 1800, 2100, 2700],
  registers: [register],
});

export const homelabAuditSubprocessExitTotal = new Counter({
  name: "homelab_audit_subprocess_exit_total",
  help: "Homelab-audit Codex SDK outcomes; the metric name and exit_code label are retained for time-series continuity",
  labelNames: ["exit_code"] as const,
  registers: [register],
});

export const homelabAuditTokensTotal = new Counter({
  name: "homelab_audit_tokens_total",
  help: "Tokens consumed by the homelab-audit Codex SDK run, by model and direction",
  labelNames: ["model", "direction"] as const,
  registers: [register],
});

export const homelabAuditEmailSentTotal = new Counter({
  name: "homelab_audit_email_sent_total",
  help: "Homelab-audit emails sent via Postal, by outcome (success | failure)",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const haEventBridgeStartFailuresTotal = new Counter({
  name: "ha_event_bridge_start_failures_total",
  help: "Home Assistant event bridge startup failures, by reason",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const haEventBridgeConnected = new Gauge({
  name: "ha_event_bridge_connected",
  help: "Whether the Home Assistant event bridge is connected (1) or currently failing to start (0)",
  registers: [register],
});

// Maintenance runs execute as direct subprocesses in the persistent Temporal
// maintenance worker. Keep a last-success gauge so stale-run alerts survive
// worker restarts and do not depend on short-lived Kubernetes resources.
export const maintenanceLastSuccessTimestampSeconds = new Gauge({
  name: "kubernetes_maintenance_last_success_timestamp_seconds",
  help: "Unix timestamp of the last successful Temporal maintenance activity, by maintenance job",
  labelNames: ["maintenance_job"] as const,
  registers: [register],
});

export const maintenanceRunsTotal = new Counter({
  name: "kubernetes_maintenance_runs_total",
  help: "Temporal maintenance activity runs, by maintenance job and outcome",
  labelNames: ["maintenance_job", "outcome"] as const,
  registers: [register],
});

export const turboCacheCleanupEntriesTotal = new Counter({
  name: "turbo_cache_cleanup_entries_total",
  help: "Turbo cache entries scanned or deleted by successful cleanup runs",
  labelNames: ["result"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// generic agent-task workflow metrics
// ---------------------------------------------------------------------------

export const agentTaskRunsTotal = new Counter({
  name: "agent_task_runs_total",
  help: "Generic scheduled agent-task runs, by provider and outcome",
  labelNames: ["provider", "outcome"] as const,
  registers: [register],
});

// Keep the pre-cutover subprocess collectors registered so existing Prometheus
// series and dashboards remain queryable. New runs use the SDK collectors.
new Histogram({
  name: "agent_task_subprocess_duration_seconds",
  help: "Historical wall-clock duration of pre-cutover Claude/Codex subprocess invocations for generic agent tasks",
  labelNames: ["provider", "model", "exit_code"] as const,
  buckets: [30, 60, 180, 300, 600, 900, 1500, 1800, 2700, 3600],
  registers: [register],
});

new Counter({
  name: "agent_task_subprocess_exit_total",
  help: "Historical pre-cutover generic agent-task subprocess exits, by provider and exit code",
  labelNames: ["provider", "exit_code"] as const,
  registers: [register],
});

export const agentTaskSdkDurationSeconds = new Histogram({
  name: "agent_task_sdk_duration_seconds",
  help: "Wall-clock duration of native Codex SDK runs",
  labelNames: ["provider", "model", "outcome"] as const,
  buckets: [30, 60, 180, 300, 600, 900, 1500, 1800, 2700, 3600],
  registers: [register],
});

export const agentTaskSdkRunsTotal = new Counter({
  name: "agent_task_sdk_runs_total",
  help: "Native agent SDK runs by provider and bounded outcome",
  labelNames: ["provider", "model", "outcome"] as const,
  registers: [register],
});

export const agentTaskOutputContractFailuresTotal = new Counter({
  name: "agent_task_output_contract_failures_total",
  help: "Claude agent-task structured-output contract failures, by provider and bounded reason",
  labelNames: ["provider", "reason"] as const,
  registers: [register],
});

export const agentTaskEmailSentTotal = new Counter({
  name: "agent_task_email_sent_total",
  help: "Generic agent-task emails sent via Postal, by outcome (success | failure)",
  labelNames: ["outcome"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// Agent progress observability. Metric names are retained across the native
// SDK cutover so old and new samples remain queryable on one timeline.
//
//   * `agent_subprocess_idle_seconds` is the longest stretch within a single
//     run without an SDK progress event. Modeled as a Histogram because
//     multiple agents can run in parallel.
//
//   * `agent_subprocess_soft_kills_total` is retained for historical CLI runs.
//     Native SDK cancellation is represented by SDK/common LLM outcomes.
// ---------------------------------------------------------------------------

export const agentSubprocessIdleSeconds = new Histogram({
  name: "agent_subprocess_idle_seconds",
  help: "Longest stretch in seconds without an agent SDK progress event, by workflow_type; the metric name is retained for time-series continuity",
  labelNames: ["workflow_type"] as const,
  buckets: [5, 15, 30, 60, 120, 300, 600, 1200, 1800],
  registers: [register],
});

new Counter({
  name: "agent_subprocess_soft_kills_total",
  help: "Historical pre-cutover SIGINT soft-kills of agent subprocesses, by workflow_type and reason",
  labelNames: ["workflow_type", "reason"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// scout-season-refresh workflow metrics
//
// Weekly LoL season-date drift check. Codex SDK researches the current season
// schedule and edits packages/scout-for-lol/.../seasons.ts when Riot has
// announced new acts or moved dates. Activity opens a PR (human review, no
// auto-merge) when there's drift; no-op when seasons.ts is already accurate.
// ---------------------------------------------------------------------------

export const scoutSeasonRefreshRunsTotal = new Counter({
  name: "scout_season_refresh_runs_total",
  help: "scout-season-refresh activity runs, by outcome (no-drift | pr-created | failed)",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const scoutSeasonRefreshDurationSeconds = new Histogram({
  name: "scout_season_refresh_duration_seconds",
  help: "Wall-clock duration of scout-season-refresh activity runs",
  labelNames: ["outcome"] as const,
  buckets: [60, 180, 300, 600, 900, 1500, 1800],
  registers: [register],
});

export const scoutSeasonRefreshSubprocessExitTotal = new Counter({
  name: "scout_season_refresh_subprocess_exit_total",
  help: "scout-season-refresh Codex SDK outcomes; the metric name and exit_code label are retained for time-series continuity",
  labelNames: ["exit_code"] as const,
  registers: [register],
});

export const scoutSeasonRefreshTokensTotal = new Counter({
  name: "scout_season_refresh_tokens_total",
  help: "Tokens consumed by the scout-season-refresh Codex SDK run, by model and direction",
  labelNames: ["model", "direction"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// velero-orphan-audit workflow metrics
//
// Detection-only metrics for orphan ZFS snapshots created by the Velero
// re-deploy pathology. Operator remediation lives in
// `runbooks/velero-orphan-snapshot-remediation.md`.
// ---------------------------------------------------------------------------

export const veleroOrphanAuditRunsTotal = new Counter({
  name: "velero_orphan_audit_runs_total",
  help: "Number of velero-orphan-audit workflow runs by outcome (success | failure)",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const veleroOrphanAuditDurationSeconds = new Histogram({
  name: "velero_orphan_audit_duration_seconds",
  help: "Wall-clock duration of velero-orphan-audit runs",
  buckets: [10, 30, 60, 120, 300, 600],
  registers: [register],
});

export const veleroOrphanLocalSnapshots = new Gauge({
  name: "velero_orphan_local_snapshots",
  help: "Local ZFS snapshots that have no matching live Velero Backup CR (per dataset)",
  labelNames: ["node", "pool", "dataset"] as const,
  registers: [register],
});

export const veleroOrphanLocalBytes = new Gauge({
  name: "velero_orphan_local_bytes",
  help: "Bytes consumed by local orphan ZFS snapshots (per dataset)",
  labelNames: ["node", "pool", "dataset"] as const,
  registers: [register],
});

export const veleroOrphanLocalSnapshotsTotal = new Gauge({
  name: "velero_orphan_local_snapshots_total",
  help: "Total local orphan ZFS snapshot count across all datasets",
  registers: [register],
});

export const veleroOrphanLocalBytesTotal = new Gauge({
  name: "velero_orphan_local_bytes_total",
  help: "Total bytes consumed by local orphan ZFS snapshots across all datasets",
  registers: [register],
});

export const veleroLiveBackupCount = new Gauge({
  name: "velero_live_backup_count",
  help: "Live Velero Backup CR count observed at audit time",
  registers: [register],
});

export const zfsDatasetSnapshotCount = new Gauge({
  name: "zfs_dataset_snapshot_count",
  help: "Total ZFS snapshot count per PVC dataset (live + orphan)",
  labelNames: ["node", "pool", "dataset"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// Workflow outcome metric — distinguishes "did the work" from "skipped
// intentionally" for check-and-skip workflows (vacuum, goodMorning*) where
// Temporal status alone (`Completed`) cannot tell the two apart.
// ---------------------------------------------------------------------------

export const workflowOutcomeTotal = new Counter({
  name: "temporal_workflow_outcome_total",
  help: "Outcomes of check-and-skip workflows: executed (body ran) vs skipped (gate short-circuited)",
  labelNames: ["workflow", "outcome", "reason"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// PR merge-conflict check (`ci/merge-conflict` status on every open PR).
// Triggered by push-to-main (kind=all-prs) and PR events (kind=single-pr).
// One observation per posted commit-status (the unit the PR UI shows).
// ---------------------------------------------------------------------------

export const prMergeConflictCheckTotal = new Counter({
  name: "pr_merge_conflict_check_total",
  help: "Commit statuses posted by the merge-conflict checker, by trigger (main push / per-PR event) and result (success=clean | failure=conflict | errored=per-PR exception)",
  labelNames: ["trigger", "result"] as const,
  registers: [register],
});

export const prMergeConflictCheckDurationSeconds = new Histogram({
  name: "pr_merge_conflict_check_duration_seconds",
  help: "Wall-clock duration of a single runCheckPrMergeConflicts activity invocation, by trigger",
  labelNames: ["trigger"] as const,
  buckets: [1, 5, 10, 20, 30, 60, 120, 300],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Schedule-registry drift
//
// registerSchedules() upserts the declared SCHEDULES and deletes the explicit
// DELETED_SCHEDULE_IDS allow-list — it never blind-prunes (that would nuke the
// dynamic /agent-tasks schedules). So a schedule that is renamed/removed from
// source but not added to DELETED_SCHEDULE_IDS keeps firing forever, unnoticed
// (this has happened 4×, most recently `pokeemerald-wasm-monthly`). This gauge
// is set once per worker startup to the count of live schedules that are
// neither declared nor a known dynamic agent-task schedule. Alert on `> 0`.
// A value of -1 (ORPHAN_DETECTION_FAILED) means the live-schedule listing
// itself failed, so the count is unknown — alert on `< 0` separately, since a
// failed scan otherwise leaves the gauge at 0 and looks identical to "clean".
// ---------------------------------------------------------------------------

export const scheduleOrphans = new Gauge({
  name: "temporal_schedule_orphans",
  help: "Live Temporal schedules not declared in register-schedules.ts (excluding dynamic agent-task schedules). >0 means a removed/renamed schedule was never added to DELETED_SCHEDULE_IDS and is still firing. -1 means orphan detection failed to list schedules (count unknown).",
  registers: [register],
});

// Glitter Discord corpus metrics moved to ./metrics-glitter.ts (this file
// was at the repo's max-lines cap) — same sibling-file pattern as
// the sibling metrics modules. Import glitterCorpus*/glitterContextRefresh*
// metrics from #observability/metrics-glitter.ts, not this file.

export const temporalFailureWatcherAlertsTotal = new Counter({
  name: "temporal_failure_watcher_alerts_total",
  help: "Detail-rich Alerts occurrences posted per failed/timed-out Temporal workflow execution",
  labelNames: ["workflowType"] as const,
  registers: [register],
});

let server: ReturnType<typeof Bun.serve> | undefined;

const jsonLog = createStructuredLogger("observability.metrics");

/**
 * Start a small HTTP server on `:9465` (override with APP_METRICS_PORT) that
 * serves the application Prometheus registry at `/metrics`. Returns the
 * resolved port so callers can log it.
 */
export function startMetricsServer(): number {
  if (server !== undefined) {
    throw new Error("Application metrics server already started");
  }

  const port = Number.parseInt(
    Bun.env["APP_METRICS_PORT"] ?? String(DEFAULT_METRICS_PORT),
    10,
  );

  server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/metrics") {
        const body = await register.metrics();
        return new Response(body, {
          status: 200,
          headers: { "content-type": register.contentType },
        });
      }
      if (url.pathname === "/healthz") {
        return new Response("ok\n", { status: 200 });
      }
      return new Response("not found\n", { status: 404 });
    },
  });

  jsonLog("info", "Application metrics server started", { port });
  return port;
}

export async function stopMetricsServer(): Promise<void> {
  if (server === undefined) {
    return;
  }
  await server.stop();
  server = undefined;
}
