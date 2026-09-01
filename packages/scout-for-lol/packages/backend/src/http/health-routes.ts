import { getRiotApiHealth } from "#src/metrics/index.ts";
import { getScoutTemporalHealth } from "#src/temporal/health.ts";

/**
 * The `/livez` and `/healthz` probe handlers.
 *
 * These live outside `server.ts` because that module starts a listening Bun
 * server the moment it is imported, so a test cannot reach the handlers there
 * without binding a port — which is why the two probes that decide whether
 * Kubernetes restarts this pod or routes traffic to it had no tests at all. A
 * probe whose failure path is never exercised is indistinguishable from one
 * that cannot fail.
 *
 * CORS headers are passed in rather than computed here, matching
 * `handleVersion`: the request-to-origin policy belongs to the server. The
 * clock and start time are injectable for the same reason — both probes are
 * defined entirely by elapsed time, and a test that cannot move the clock can
 * only ever observe the healthy answer.
 */

/** Grace period after startup during which liveness always passes. */
export const STARTUP_GRACE_PERIOD_MS = 5 * 60 * 1000;

const applicationStartTime = Date.now();

export type HealthRouteOptions = {
  readonly cors: Record<string, string>;
  /** Overridden by tests; defaults to this process's own start time. */
  readonly startedAt?: number;
  readonly now?: number;
};

/** Liveness: fail only on a condition a restart actually fixes. */
export function handleLivez({
  cors,
  startedAt = applicationStartTime,
  now = Date.now(),
}: HealthRouteOptions): Response {
  const { lastSuccessTimestamp, lastAttemptTimestamp } = getRiotApiHealth();
  const uptimeMs = now - startedAt;

  // Grace period: first 5 minutes after startup, always healthy
  if (uptimeMs < STARTUP_GRACE_PERIOD_MS) {
    return Response.json(
      { healthy: true, reason: "startup-grace-period", uptimeMs },
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...cors },
      },
    );
  }

  // After grace: unhealthy if API attempts exist in last 20 min AND last success >15 min ago
  const twentyMinutesMs = 20 * 60 * 1000;
  const fifteenMinutesMs = 15 * 60 * 1000;
  const hasRecentAttempts =
    lastAttemptTimestamp !== undefined &&
    now - lastAttemptTimestamp < twentyMinutesMs;
  const lastSuccessStale =
    lastSuccessTimestamp === undefined ||
    now - lastSuccessTimestamp > fifteenMinutesMs;
  const riotApiHealthy = !(hasRecentAttempts && lastSuccessStale);

  return Response.json(
    {
      healthy: riotApiHealthy,
      lastSuccessTimestamp: lastSuccessTimestamp ?? null,
      lastAttemptTimestamp: lastAttemptTimestamp ?? null,
      uptimeMs,
      components: { riotApiHealthy },
    },
    {
      status: riotApiHealthy ? 200 : 503,
      headers: { "Content-Type": "application/json", ...cors },
    },
  );
}

/** Readiness: whether this replica should receive traffic. */
export function handleHealthz({
  cors,
  startedAt = applicationStartTime,
  now = Date.now(),
}: HealthRouteOptions): Response {
  const { lastSuccessTimestamp, lastAttemptTimestamp } = getRiotApiHealth();
  const uptimeSeconds = (now - startedAt) / 1000;

  // Unhealthy if: API attempts exist in last 10 minutes AND last success was >5 minutes ago
  const tenMinutesMs = 10 * 60 * 1000;
  const fiveMinutesMs = 5 * 60 * 1000;
  const hasRecentAttempts =
    lastAttemptTimestamp !== undefined &&
    now - lastAttemptTimestamp < tenMinutesMs;
  const lastSuccessStale =
    lastSuccessTimestamp === undefined ||
    now - lastSuccessTimestamp > fiveMinutesMs;
  const healthy = !(hasRecentAttempts && lastSuccessStale);

  return Response.json(
    {
      healthy,
      lastSuccessTimestamp: lastSuccessTimestamp ?? null,
      lastAttemptTimestamp: lastAttemptTimestamp ?? null,
      uptimeSeconds,
      components: { temporal: getScoutTemporalHealth() },
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Content-Type": "application/json", ...cors },
    },
  );
}
