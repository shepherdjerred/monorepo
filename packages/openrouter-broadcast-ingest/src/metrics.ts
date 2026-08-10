import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

export type BroadcastMetrics = ReturnType<typeof createBroadcastMetrics>;

export function createBroadcastMetrics(register: Registry = new Registry()) {
  register.setDefaultLabels({ service: "openrouter-broadcast-ingest" });
  collectDefaultMetrics({
    register,
    prefix: "openrouter_broadcast_ingest_",
  });

  const requestsTotal = new Counter({
    name: "openrouter_broadcast_requests_total",
    help: "OpenRouter Broadcast deliveries by bounded outcome",
    labelNames: ["outcome"] as const,
    registers: [register],
  });
  const operationsTotal = new Counter({
    name: "openrouter_broadcast_operations_total",
    help: "Archive, forwarding, and duplicate-detection operations",
    labelNames: ["operation", "outcome"] as const,
    registers: [register],
  });
  const requestDurationSeconds = new Histogram({
    name: "openrouter_broadcast_request_duration_seconds",
    help: "End-to-end authenticated Broadcast request duration",
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
  });
  const payloadBytes = new Histogram({
    name: "openrouter_broadcast_payload_bytes",
    help: "Accepted OTLP JSON payload size",
    buckets: [1024, 16_384, 65_536, 262_144, 1_048_576, 5_242_880],
    registers: [register],
  });
  const lastSuccessTimestampSeconds = new Gauge({
    name: "openrouter_broadcast_last_success_timestamp_seconds",
    help: "Unix timestamp of the last completely archived and forwarded delivery",
    registers: [register],
  });

  return {
    lastSuccessTimestampSeconds,
    operationsTotal,
    payloadBytes,
    register,
    requestDurationSeconds,
    requestsTotal,
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
    if (request.method === "GET" && url.pathname === "/livez") {
      return new Response("ok\n");
    }
    return new Response("not found\n", { status: 404 });
  };
}
