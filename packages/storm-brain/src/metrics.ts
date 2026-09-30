import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

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
