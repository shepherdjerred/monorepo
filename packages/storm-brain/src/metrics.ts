import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import {
  createFlagMetricsRecorder,
  FEATURE_FLAG_METRICS,
  FEATURE_FLAG_METRIC_LABELS,
} from "@shepherdjerred/feature-flags/observability.ts";

export type BrainMetrics = ReturnType<typeof createBrainMetrics>;

export function createBrainMetrics(register: Registry = new Registry()) {
  register.setDefaultLabels({ service: "storm-brain" });
  collectDefaultMetrics({ register, prefix: "storm_brain_" });

  const requestsTotal = new Counter({
    name: "storm_brain_requests_total",
    help: "Brain requests by flow and bounded outcome",
    labelNames: ["flow", "outcome"] as const,
    registers: [register],
  });
  const requestDurationSeconds = new Histogram({
    name: "storm_brain_request_duration_seconds",
    help: "End-to-end authenticated brain request duration",
    labelNames: ["flow"] as const,
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registers: [register],
  });
  const costMicrosTotal = new Counter({
    name: "storm_brain_cost_micros_total",
    help: "Billed LLM cost in millionths of a dollar, including failed calls",
    labelNames: ["flow"] as const,
    registers: [register],
  });
  const tokensTotal = new Counter({
    name: "storm_brain_tokens_total",
    help: "LLM tokens by flow and kind",
    labelNames: ["flow", "kind"] as const,
    registers: [register],
  });
  const payloadBytes = new Histogram({
    name: "storm_brain_payload_bytes",
    help: "Accepted request payload size",
    labelNames: ["flow"] as const,
    buckets: [1024, 4096, 16_384, 65_536, 262_144],
    registers: [register],
  });

  return {
    featureFlags: createFlagMetricsRecorder({
      evaluations: new Counter({
        name: FEATURE_FLAG_METRICS.evaluations,
        help: "Feature flag evaluations by bounded result",
        labelNames: FEATURE_FLAG_METRIC_LABELS.evaluations,
        registers: [register],
      }),
      errors: new Counter({
        name: FEATURE_FLAG_METRICS.errors,
        help: "Feature flag errors by operation",
        labelNames: FEATURE_FLAG_METRIC_LABELS.errors,
        registers: [register],
      }),
      providerReady: new Gauge({
        name: FEATURE_FLAG_METRICS.providerReady,
        help: "Feature flag provider readiness",
        registers: [register],
      }),
      snapshotAge: new Gauge({
        name: FEATURE_FLAG_METRICS.snapshotAge,
        help: "Feature flag snapshot age in seconds",
        registers: [register],
      }),
      providerInfo: new Gauge({
        name: FEATURE_FLAG_METRICS.providerInfo,
        help: "Configured Flipt environment and namespace",
        labelNames: FEATURE_FLAG_METRIC_LABELS.providerInfo,
        registers: [register],
      }),
    }),
    costMicrosTotal,
    payloadBytes,
    register,
    requestDurationSeconds,
    requestsTotal,
    tokensTotal,
  };
}

export function createMetricsHandler(register: Registry) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/metrics") {
      return new Response(await register.metrics(), {
        headers: { "Content-Type": register.contentType },
      });
    }
    return request.method === "GET" && url.pathname === "/livez"
      ? new Response("ok\n")
      : new Response("not found\n", { status: 404 });
  };
}
