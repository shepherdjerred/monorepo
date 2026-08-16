import { Counter, Histogram, type Registry } from "prom-client";

export type CommonLlmMetrics = {
  requests: Counter<"service" | "workload" | "provider" | "model" | "outcome">;
  duration: Histogram<"service" | "workload" | "provider" | "model">;
  tokens: Counter<"service" | "workload" | "provider" | "model" | "type">;
  cost: Counter<"service" | "workload" | "provider" | "model" | "type">;
};

const metricsByRegister = new WeakMap<Registry, CommonLlmMetrics>();

/**
 * Return the repository-wide bounded-cardinality LLM instruments for a
 * registry. OpenRouter and native coding-agent SDKs deliberately share these
 * collectors so a service can expose both without duplicate registration.
 */
export function commonLlmMetrics(register: Registry): CommonLlmMetrics {
  const existing = metricsByRegister.get(register);
  if (existing !== undefined) return existing;

  const metrics: CommonLlmMetrics = {
    requests: new Counter({
      name: "llm_requests_total",
      help: "Logical LLM requests by bounded workload and outcome.",
      labelNames: ["service", "workload", "provider", "model", "outcome"],
      registers: [register],
    }),
    duration: new Histogram({
      name: "llm_request_duration_seconds",
      help: "LLM request duration in seconds.",
      labelNames: ["service", "workload", "provider", "model"],
      registers: [register],
    }),
    tokens: new Counter({
      name: "llm_tokens_total",
      help: "LLM tokens by bounded token type.",
      labelNames: ["service", "workload", "provider", "model", "type"],
      registers: [register],
    }),
    cost: new Counter({
      name: "llm_cost_usd_total",
      help: "LLM cost in USD by accounting source.",
      labelNames: ["service", "workload", "provider", "model", "type"],
      registers: [register],
    }),
  };
  metricsByRegister.set(register, metrics);
  return metrics;
}
