import { Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Current request count within the active Riot app rate-limit window, parsed
 * from the `X-App-Rate-Limit-Count` response header.
 */
export const riotApiAppRateLimitCount = new Gauge({
  name: "riot_api_app_rate_limit_count",
  help: "Current request count within the active Riot app rate-limit window",
  labelNames: ["window_seconds"] as const,
  registers: [registry],
});

/**
 * Configured Riot app rate-limit ceiling for the current window, parsed from
 * the `X-App-Rate-Limit` response header.
 */
export const riotApiAppRateLimitLimit = new Gauge({
  name: "riot_api_app_rate_limit_limit",
  help: "Configured Riot app rate-limit ceiling for the current window",
  labelNames: ["window_seconds"] as const,
  registers: [registry],
});
