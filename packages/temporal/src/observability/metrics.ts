import {
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  Registry,
} from "prom-client";

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
// PR review / summary bot metrics
// ---------------------------------------------------------------------------

export const prWebhookReceivedTotal = new Counter({
  name: "pr_webhook_received_total",
  help: "GitHub webhook deliveries received and accepted (post signature verify), by event type and action",
  labelNames: ["event", "action"] as const,
  registers: [register],
});

export const prWebhookSkippedTotal = new Counter({
  name: "pr_webhook_skipped_total",
  help: "GitHub webhook deliveries skipped without starting workflows, by reason (draft, bot-author, action:<x>, etc.)",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const prWebhookSignatureFailuresTotal = new Counter({
  name: "pr_webhook_signature_failures_total",
  help: "GitHub webhook deliveries rejected for missing or invalid X-Hub-Signature-256",
  registers: [register],
});

// ---------------------------------------------------------------------------
// PR summary (SDK-native, Haiku) — Phase 7 of the SOTA PR review bot plan
// ---------------------------------------------------------------------------

export const prSummaryDurationSeconds = new Histogram({
  name: "pr_summary_duration_seconds",
  help: "Wall-clock duration of SDK-native PR summary activity runs",
  labelNames: ["model", "action"] as const,
  buckets: [5, 10, 20, 30, 45, 60, 90, 120, 180],
  registers: [register],
});

export const prSummaryCostUsd = new Histogram({
  name: "pr_summary_cost_usd",
  help: "Estimated USD cost per PR summary, derived from token usage + Haiku pricing",
  labelNames: ["model"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.2, 0.5],
  registers: [register],
});

export const prSummaryTokensTotal = new Counter({
  name: "pr_summary_tokens_total",
  help: "Tokens consumed by the SDK-native PR summary activity, by model and direction (input/output/cache_create/cache_read)",
  labelNames: ["model", "direction"] as const,
  registers: [register],
});

export const prSummaryCommentsTotal = new Counter({
  name: "pr_summary_comments_total",
  help: "PR summary comments posted by the bot, by action (created | updated)",
  labelNames: ["action"] as const,
  registers: [register],
});

export const aiProviderErrorsTotal = new Counter({
  name: "ai_provider_errors_total",
  help: "AI provider-side operational errors by app, provider, kind, and source",
  labelNames: ["app", "provider", "kind", "source"] as const,
  registers: [register],
});

export const aiProviderIssueActive = new Gauge({
  name: "ai_provider_issue_active",
  help: "Whether an AI provider operational issue is currently active for this app/source",
  labelNames: ["app", "provider", "kind", "source"] as const,
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
// Agent subprocess wall-clock observability (shared between alert-remediation
// and agent-task). The point of these two metrics is to make a hang
// distinguishable from a long-but-progressing run on the dashboard:
//
//   * `agent_subprocess_idle_seconds` is the longest stretch within a single
//     subprocess run where no stderr was seen. A subprocess that's working
//     emits stderr periodically; a wedged tool call (slow WebFetch / hung
//     kubectl pipe / API retry loop) is silent. Heat-mapping this exposes
//     the tail.
//
//   * `agent_subprocess_soft_kills_total` ticks when the activity itself
//     sends SIGINT before Temporal's startToCloseTimeout SIGTERM lands. The
//     soft-kill path captures last-stderr state for diagnosis; the counter
//     makes that path alertable.
// ---------------------------------------------------------------------------

export const agentSubprocessIdleSeconds = new Gauge({
  name: "agent_subprocess_idle_seconds",
  help: "Longest stretch (in seconds) of subprocess silence (no stderr) observed during the most recent agent subprocess run, by workflow_type. Reset per run.",
  labelNames: ["workflow_type"] as const,
  registers: [register],
});

export const agentSubprocessSoftKillsTotal = new Counter({
  name: "agent_subprocess_soft_kills_total",
  help: "Pre-emptive SIGINT kills sent to the agent subprocess by the activity (T-90s before Temporal startToCloseTimeout would SIGTERM), by workflow_type and reason",
  labelNames: ["workflow_type", "reason"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// alert-remediation workflow metrics
//
// The sweep workflow fans out one child per normalized PagerDuty/Bugsink
// alert; each child runs the `runAlertRemediationAgent` activity which
// shells out to `claude -p`. Until 2026-06-14 this surface had zero
// metrics — failures were only observable by inspecting individual
// workflow histories, which is how a 14-day all-failed regression went
// unnoticed.
// ---------------------------------------------------------------------------

export const alertRemediationDecisionsTotal = new Counter({
  name: "alert_remediation_decisions_total",
  help: "Decisions reached by the alert-remediation agent, by decision label, outcome (pr-created | report-only | not-straightforward | verification-failed | failed), and alert source (pagerduty | bugsink)",
  labelNames: ["decision", "outcome", "source"] as const,
  registers: [register],
});

export const alertRemediationSubprocessDurationSeconds = new Histogram({
  name: "alert_remediation_subprocess_duration_seconds",
  help: "Wall-clock duration of `claude -p` subprocess invocations for the alert-remediation agent",
  labelNames: ["model", "exit_code"] as const,
  buckets: [30, 60, 180, 300, 600, 900, 1500, 1800, 2700],
  registers: [register],
});

export const alertRemediationSubprocessExitTotal = new Counter({
  name: "alert_remediation_subprocess_exit_total",
  help: "alert-remediation claude subprocess exits, by exit code and signal (natural | SIGINT | SIGTERM)",
  labelNames: ["exit_code", "signal"] as const,
  registers: [register],
});

// Sweep-level wall clock + per-disposition alert flow are covered by the
// Temporal SDK's built-in `temporal_workflow_completed_total{workflow_type,
// status}` and the child-level `alert_remediation_decisions_total` (which
// carries the `source` label). Don't double-emit.

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
  labelNames: ["pool", "dataset"] as const,
  registers: [register],
});

export const veleroOrphanLocalBytes = new Gauge({
  name: "velero_orphan_local_bytes",
  help: "Bytes consumed by local orphan ZFS snapshots (per dataset)",
  labelNames: ["pool", "dataset"] as const,
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
  labelNames: ["pool", "dataset"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// pr-review metrics (Phase 1+ of the SOTA PR review bot — see
// packages/docs/plans/2026-05-10_sota-pr-review-bot.md). Eval's Grafana
// dashboard (Phase 8) targets the `pr_review_*` namespace; do not bake the
// word "pipeline" into the names.
//
// `pr_review_posted_total` is the post-activity outcome counter (one tick
// per *posted* comment, label distinguishes fresh-create vs edit-in-place).
// Eval owns the workflow-lifecycle counter `pr_review_count_total{repo,
// status=posted|skipped|failed}` in their Task 8 PR — that one ticks once
// per run regardless of post outcome (including kill-switch suppressions
// and pre-post failures). Different semantics, different labels, different
// name.
// ---------------------------------------------------------------------------

export const prReviewPostedTotal = new Counter({
  name: "pr_review_posted_total",
  help: "pr-review post-activity comments posted to GitHub, by edit-vs-create outcome",
  labelNames: ["owner", "repo", "outcome"] as const,
  registers: [register],
});

export const prReviewFindingsPerPr = new Histogram({
  name: "pr_review_findings_per_pr",
  help: "Findings posted per PR by the pr-review pipeline",
  buckets: [0, 1, 2, 3, 5, 10, 20, 50],
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

// Phase 3 latency telemetry per specialist call. Companions the
// `pr_review_cost_usd{model, specialist}` histogram in
// `./pr-review-metrics.ts` so a single dashboard row can plot
// (cost, latency) per specialist.
export const prReviewSpecialistLatencySeconds = new Histogram({
  name: "pr_review_specialist_latency_seconds",
  help: "Per-specialist-call wall-clock latency in seconds, by model and specialist",
  labelNames: ["model", "specialist"] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [register],
});

// Phase 3 consensus drop-rate counter: every raw finding is either kept or
// dropped, exactly once. `(dropped / (kept+dropped))` is the consensus drop
// rate and a load-bearing alert signal — if it falls to zero, voting has
// silently degenerated to passthrough. Pairs with the per-run gauge
// `pr_review_consensus_drop_rate` in `./pr-review-metrics.ts`.
export const prReviewConsensusFindingsTotal = new Counter({
  name: "pr_review_consensus_findings_total",
  help: "Findings entering the consensus stage, by post-consensus outcome (kept | dropped)",
  labelNames: ["outcome"] as const,
  registers: [register],
});

// Phase 4 verification outcome counter: each finding entering the verify
// stage records exactly one observation. `outcome ∈ {verified, unverified,
// contradicted}` — the `contradicted` count divided by the total is the
// `pr_review_verification_drop_rate` gauge in `./pr-review-metrics.ts`.
// Labeled by `verifier` (typecheck/eslint/grep/test/none) so dashboards
// can attribute drop rate to the verifier that fired.
export const prReviewVerifyFindingsTotal = new Counter({
  name: "pr_review_verify_findings_total",
  help: "Findings entering the verify stage, by verifier kind and post-verification outcome (verified | unverified | contradicted)",
  labelNames: ["verifier", "outcome"] as const,
  registers: [register],
});

let server: ReturnType<typeof Bun.serve> | undefined;

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: "temporal-worker",
      module: "observability.metrics",
      ...fields,
    }),
  );
}

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
