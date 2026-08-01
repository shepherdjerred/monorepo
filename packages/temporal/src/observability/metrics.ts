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
  help: "Wall-clock duration of `claude -p` subprocess invocations for the homelab daily audit",
  labelNames: ["model", "exit_code"] as const,
  buckets: [60, 300, 600, 900, 1500, 1800, 2100, 2700],
  registers: [register],
});

export const homelabAuditSubprocessExitTotal = new Counter({
  name: "homelab_audit_subprocess_exit_total",
  help: "Homelab-audit claude subprocess exits, by exit code",
  labelNames: ["exit_code"] as const,
  registers: [register],
});

export const homelabAuditTokensTotal = new Counter({
  name: "homelab_audit_tokens_total",
  help: "Tokens consumed by the homelab-audit claude subprocess, by model and direction",
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

// ---------------------------------------------------------------------------
// generic agent-task workflow metrics
// ---------------------------------------------------------------------------

export const agentTaskRunsTotal = new Counter({
  name: "agent_task_runs_total",
  help: "Generic scheduled agent-task runs, by provider and outcome",
  labelNames: ["provider", "outcome"] as const,
  registers: [register],
});

export const agentTaskSubprocessDurationSeconds = new Histogram({
  name: "agent_task_subprocess_duration_seconds",
  help: "Wall-clock duration of Claude/Codex subprocess invocations for generic agent tasks",
  labelNames: ["provider", "model", "exit_code"] as const,
  buckets: [30, 60, 180, 300, 600, 900, 1500, 1800, 2700, 3600],
  registers: [register],
});

export const agentTaskSubprocessExitTotal = new Counter({
  name: "agent_task_subprocess_exit_total",
  help: "Generic agent-task subprocess exits, by provider and exit code",
  labelNames: ["provider", "exit_code"] as const,
  registers: [register],
});

export const agentTaskEmailSentTotal = new Counter({
  name: "agent_task_email_sent_total",
  help: "Generic agent-task emails sent via Postal, by outcome (success | failure)",
  labelNames: ["outcome"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// Agent subprocess wall-clock observability (shared across every agent
// subprocess activity, e.g. agent-task / homelab-audit / scout-season-refresh).
// The
// point of these two metrics is to make a hang distinguishable from a
// long-but-progressing run on the dashboard:
//
//   * `agent_subprocess_idle_seconds` is the longest stretch within a single
//     subprocess run where no stderr was seen. A subprocess that's working
//     emits stderr periodically; a wedged tool call (slow WebFetch / hung
//     kubectl pipe / API retry loop) is silent. Modeled as a Histogram (not
//     a Gauge) because multiple agent subprocesses can run in parallel — a
//     Gauge would last-writer-wins and silently drop the other observations.
//     The Histogram accumulates every run's max-idle so the dashboard p95
//     reflects the worst real hang across all concurrent runs.
//
//   * `agent_subprocess_soft_kills_total` ticks when the activity itself
//     sends SIGINT before Temporal's startToCloseTimeout SIGTERM lands. The
//     soft-kill path captures last-stderr state for diagnosis; the counter
//     makes that path alertable.
// ---------------------------------------------------------------------------

export const agentSubprocessIdleSeconds = new Histogram({
  name: "agent_subprocess_idle_seconds",
  help: "Longest stretch (in seconds) of subprocess silence (no stderr) observed during a single agent subprocess run, by workflow_type. One observation per run; histogram-shaped so concurrent runs don't clobber each other.",
  labelNames: ["workflow_type"] as const,
  buckets: [5, 15, 30, 60, 120, 300, 600, 1200, 1800],
  registers: [register],
});

export const agentSubprocessSoftKillsTotal = new Counter({
  name: "agent_subprocess_soft_kills_total",
  help: "Pre-emptive SIGINT kills sent to the agent subprocess by the activity (T-90s before Temporal startToCloseTimeout would SIGTERM), by workflow_type and reason",
  labelNames: ["workflow_type", "reason"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// scout-season-refresh workflow metrics
//
// Weekly LoL season-date drift check. claude -p researches the current season
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
  help: "scout-season-refresh claude subprocess exits, by exit code",
  labelNames: ["exit_code"] as const,
  registers: [register],
});

export const scoutSeasonRefreshTokensTotal = new Counter({
  name: "scout_season_refresh_tokens_total",
  help: "Tokens consumed by the scout-season-refresh claude subprocess, by model and direction",
  labelNames: ["model", "direction"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// velero-orphan-audit workflow metrics
//
// Detection-only metrics for orphan ZFS snapshots created by the Velero
// re-deploy pathology. See:
//   - packages/docs/decisions/2026-05-05_velero-orphan-snapshot-prevention.md
//   - packages/docs/guides/2026-05-05_velero-orphan-snapshot-remediation.md
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
// One observation per posted commit-status (the unit the PR UI shows). See
// packages/docs/plans/2026-06-14_pr-merge-conflict-check.md.
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
// Review-signal collector — durable longitudinal record of "what the code-
// review provider did and when" (see src/activities/observe-review-signals.ts
// and @shepherdjerred/code-review's ReviewSignalEvent). Provider-neutral: the
// `provider` label carries the active provider id (REVIEW_PROVIDER, default
// `codex`). The CI gate (scripts/wait-for-review.ts) emits the same event
// shape as structured logs only; this collector is the metrics + S3 side.
// ---------------------------------------------------------------------------

export const reviewCompletionLatencySeconds = new Histogram({
  name: "review_completion_latency_seconds",
  help: "Seconds from PR head-commit push to the review provider's completion signal (review-at-head, check-run, or 👍 reaction), by provider. Only observed when the reviewed commit is confirmed to be the head.",
  labelNames: ["provider"] as const,
  buckets: [30, 60, 120, 300, 600, 900, 1200, 1800, 3600],
  registers: [register],
});

export const reviewFindingsTotal = new Counter({
  name: "review_findings_total",
  help: "Review findings observed by the review-signal collector, by provider and severity (p0|p1|p2|p3|unknown)",
  labelNames: ["provider", "severity"] as const,
  registers: [register],
});

export const reviewFindingsPerPr = new Histogram({
  name: "review_findings_per_pr",
  help: "Total findings per PR observed by the review-signal collector, by provider",
  labelNames: ["provider"] as const,
  buckets: [0, 1, 2, 3, 5, 10, 20],
  registers: [register],
});

export const reviewCompletionSignalTotal = new Counter({
  name: "review_completion_signal_total",
  help: "Review-signal collector observations by provider and completion signal (check-run|review-at-head|thumbsup-reaction|none)",
  labelNames: ["provider", "signal"] as const,
  registers: [register],
});

export const reviewStaleReactionTotal = new Counter({
  name: "review_stale_reaction_total",
  help: "Review-signal collector observations where a clean 👍 reaction existed but the reviewed commit was not the current head, by provider",
  labelNames: ["provider"] as const,
  registers: [register],
});

export const reviewReviewedHeadTotal = new Counter({
  name: "review_reviewed_head_total",
  help: "Review-signal collector observations, by provider and whether the provider's most recently observed review/reaction is confirmed to be for the exact head commit (at_head = true|false)",
  labelNames: ["provider", "at_head"] as const,
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

// ---------------------------------------------------------------------------
// Glitter Discord corpus
// ---------------------------------------------------------------------------

export const glitterCorpusDiscordRequestsTotal = new Counter({
  name: "glitter_corpus_discord_requests_total",
  help: "Discord REST requests made by the corpus archiver, by outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const glitterCorpusPagesTotal = new Counter({
  name: "glitter_corpus_pages_total",
  help: "Immutable Discord response pages stored by traversal direction",
  labelNames: ["direction"] as const,
  registers: [register],
});

export const glitterCorpusMessagesObservedTotal = new Counter({
  name: "glitter_corpus_messages_observed_total",
  help: "Message observations captured from Discord REST by traversal direction",
  labelNames: ["direction"] as const,
  registers: [register],
});

export const glitterCorpusInventoryEntries = new Gauge({
  name: "glitter_corpus_inventory_entries",
  help: "Latest discovered Discord channel/thread inventory by scope decision",
  labelNames: ["decision"] as const,
  registers: [register],
});

export const glitterCorpusInventoryScopeChanges = new Gauge({
  name: "glitter_corpus_inventory_scope_changes",
  help: "Channel and thread scope changes between the latest Discord inventory and the published baseline",
  labelNames: ["change"] as const,
  registers: [register],
});

export const glitterCorpusSnapshotMessages = new Gauge({
  name: "glitter_corpus_snapshot_messages",
  help: "Unique messages in the most recently published complete guild snapshot",
  registers: [register],
});

export const glitterCorpusLastSnapshotTimestampSeconds = new Gauge({
  name: "glitter_corpus_last_snapshot_timestamp_seconds",
  help: "Unix timestamp of the most recently published complete guild snapshot",
  registers: [register],
});

export const glitterCorpusSnapshotMetricsConfigured = new Gauge({
  name: "glitter_corpus_snapshot_metrics_configured",
  help: "1 when the worker has enough storage configuration to restore Glitter corpus snapshot metrics after restart",
  registers: [register],
});

export const glitterCorpusStorageIntegrityFailuresTotal = new Counter({
  name: "glitter_corpus_storage_integrity_failures_total",
  help: "Missing, collided, or checksum-invalid Glitter corpus objects in SeaweedFS",
  registers: [register],
});

export const glitterContextRefreshRunsTotal = new Counter({
  name: "glitter_context_refresh_runs_total",
  help: "Weekly verified Glitter context refresh runs by outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const glitterContextRefreshPeople = new Gauge({
  name: "glitter_context_refresh_people",
  help: "People eligible for or refreshed by the latest Glitter context run",
  labelNames: ["state"] as const,
  registers: [register],
});

export const glitterContextRefreshRelationshipProposals = new Gauge({
  name: "glitter_context_refresh_relationship_proposals",
  help: "Evidence-backed relationship updates in the latest Glitter context run",
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
