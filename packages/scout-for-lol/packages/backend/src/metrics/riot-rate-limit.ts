import { Counter, Gauge, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Current request count within the active Riot app rate-limit window, parsed
 * from the `X-App-Rate-Limit-Count` response header.
 */
export const riotApiAppRateLimitCount = new Gauge({
  name: "riot_api_app_rate_limit_count",
  help: "Current request count within the active Riot app rate-limit window",
  labelNames: ["route", "window_seconds"] as const,
  registers: [registry],
});

/**
 * Configured Riot app rate-limit ceiling for the current window, parsed from
 * the `X-App-Rate-Limit` response header.
 */
export const riotApiAppRateLimitLimit = new Gauge({
  name: "riot_api_app_rate_limit_limit",
  help: "Configured Riot app rate-limit ceiling for the current window",
  labelNames: ["route", "window_seconds"] as const,
  registers: [registry],
});

/**
 * Per-route, per-method request count within the active window, parsed from
 * `X-Method-Rate-Limit-Count`. The `method` label is a templated endpoint from
 * a fixed allow-list (unknown paths are `other`), so cardinality is bounded by
 * routes x methods x windows.
 */
export const riotApiMethodRateLimitCount = new Gauge({
  name: "riot_api_method_rate_limit_count",
  help: "Current request count within the active Riot method rate-limit window",
  labelNames: ["route", "method", "window_seconds"] as const,
  registers: [registry],
});

/**
 * Per-route, per-method rate-limit ceiling, parsed from `X-Method-Rate-Limit`.
 */
export const riotApiMethodRateLimitLimit = new Gauge({
  name: "riot_api_method_rate_limit_limit",
  help: "Configured Riot method rate-limit ceiling for the current window",
  labelNames: ["route", "method", "window_seconds"] as const,
  registers: [registry],
});

/**
 * Riot 429 responses by routing host, which limit was enforced
 * (`application`, `method`, `service`, or `unknown`), and the priority class
 * of the request that received it.
 */
export const riotApi429Total = new Counter({
  name: "riot_api_429_total",
  help: "Riot API 429 responses by route, enforced limit type, and request priority",
  labelNames: ["route", "limit_type", "priority"] as const,
  registers: [registry],
});

/**
 * Time one request attempt spent in the limiter before it was sent: waiting
 * for a concurrency slot, a Retry-After cooldown, and (in `enforce` mode) the
 * budget ledger. Labelled only by the bounded priority class.
 */
export const riotApiLimiterWaitSeconds = new Histogram({
  name: "riot_api_limiter_wait_seconds",
  help: "Time a Riot API request attempt waited in the limiter before sending, by priority",
  labelNames: ["priority"] as const,
  buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

/**
 * The budget ledger's decision for each request attempt. `admitted` and
 * `deferred` are what the limiter did; `would_defer` is a refusal the limiter
 * ignored because the budget mode is `observe`. `reason` is the ledger's
 * bounded refusal reason (`none` when admitted).
 */
export const riotApiLimiterDecisionsTotal = new Counter({
  name: "riot_api_limiter_decisions_total",
  help: "Riot budget ledger decisions by route, priority, outcome, and reason",
  labelNames: ["route", "priority", "outcome", "reason"] as const,
  registers: [registry],
});
