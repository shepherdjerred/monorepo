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

export const prAgentSubprocessDurationSeconds = new Histogram({
  name: "pr_agent_subprocess_duration_seconds",
  help: "Wall-clock duration of `claude -p` subprocess invocations for PR review/summary agents",
  labelNames: ["kind", "model", "exit_code"] as const,
  buckets: [10, 30, 60, 120, 300, 600, 900, 1500],
  registers: [register],
});

export const prAgentSubprocessExitTotal = new Counter({
  name: "pr_agent_subprocess_exit_total",
  help: "PR-agent claude subprocess exits, by kind (review/summary) and exit code",
  labelNames: ["kind", "exit_code"] as const,
  registers: [register],
});

export const prAgentTokensTotal = new Counter({
  name: "pr_agent_tokens_total",
  help: "Tokens consumed by PR-agent claude subprocesses, by kind, model, and direction (input/output/cache_create/cache_read)",
  labelNames: ["kind", "model", "direction"] as const,
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
