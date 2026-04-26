import {
  Counter,
  Histogram,
  collectDefaultMetrics,
  Registry,
} from "prom-client";

const DEFAULT_METRICS_PORT = 9465;

/**
 * Custom Prometheus registry for application-level metrics. Separate from
 * the Temporal SDK's built-in Prometheus bridge (which scrapes on :9464);
 * this one is for metrics emitted by our own activities and workflows.
 *
 * Metric handles for individual workflows (e.g. docs-groom) are registered
 * by their own modules against this registry.
 */
export const register = new Registry();

register.setDefaultLabels({ component: "temporal-worker" });
collectDefaultMetrics({ register, prefix: "temporal_worker_app_" });

// ---------------------------------------------------------------------------
// docs-groom workflow metrics
// ---------------------------------------------------------------------------

export const docsGroomRunsTotal = new Counter({
  name: "docs_groom_runs_total",
  help: "Number of docs-groom workflow runs by phase and outcome",
  labelNames: ["phase", "outcome"] as const,
  registers: [register],
});

export const docsGroomTasksIdentifiedTotal = new Counter({
  name: "docs_groom_tasks_identified_total",
  help: "Number of grooming tasks identified by an audit, by difficulty and category",
  labelNames: ["difficulty", "category"] as const,
  registers: [register],
});

export const docsGroomPrsOpenedTotal = new Counter({
  name: "docs_groom_prs_opened_total",
  help: "Number of draft PRs opened by docs-groom (kind: grooming or implementation)",
  labelNames: ["kind"] as const,
  registers: [register],
});

export const docsGroomClaudeDurationSeconds = new Histogram({
  name: "docs_groom_claude_duration_seconds",
  help: "Wall-clock duration of `claude -p` invocations, by phase",
  labelNames: ["phase"] as const,
  buckets: [30, 60, 120, 300, 600, 1200, 1800],
  registers: [register],
});

export const docsGroomClaudeCostUsdTotal = new Counter({
  name: "docs_groom_claude_cost_usd_total",
  help: "Cumulative cost in USD of `claude -p` invocations, by phase (from total_cost_usd in result message)",
  labelNames: ["phase"] as const,
  registers: [register],
});

export const docsGroomClaudeTokensTotal = new Counter({
  name: "docs_groom_claude_tokens_total",
  help: "Cumulative tokens consumed by `claude -p` invocations, by phase and kind",
  labelNames: ["phase", "kind"] as const,
  registers: [register],
});

export const docsGroomValidateRejectionsTotal = new Counter({
  name: "docs_groom_validate_rejections_total",
  help: "Diff validation rejections by reason (empty-diff, secret, gitignored, branch-main, typecheck-failed)",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const docsGroomFilteredAlreadyOpenTotal = new Counter({
  name: "docs_groom_filtered_already_open_total",
  help: "Tasks dropped because a PR with the same slug was already open or recently closed",
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
