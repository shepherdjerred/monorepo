import { Counter, Gauge } from "prom-client";
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
 * Riot 429 responses by routing host and which limit was enforced
 * (`application`, `method`, `service`, or `unknown`).
 */
export const riotApi429Total = new Counter({
  name: "riot_api_429_total",
  help: "Riot API 429 responses by route and enforced limit type",
  labelNames: ["route", "limit_type"] as const,
  registers: [registry],
});
