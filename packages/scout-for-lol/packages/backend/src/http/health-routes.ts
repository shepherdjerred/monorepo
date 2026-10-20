import { getRiotApiHealth } from "#src/metrics/index.ts";
import { getScoutTemporalHealth } from "#src/temporal/health.ts";
import {
  evaluateDiscordGatewayLiveness,
  getDiscordGatewayHealth,
} from "#src/metrics/platform/discord-gateway-health.ts";

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

/**
 * Whether Riot calls are failing: the newest attempt came after the last
 * success, recently, and that success is stale. A successful call stamps both
 * clocks, so an idle replica whose last call succeeded is never failing; a
 * role that only calls Riot on user actions would otherwise read as broken a
 * few minutes into every quiet stretch.
 */
function riotApiFailing(
  now: number,
  attemptWindowMs: number,
  successStaleMs: number,
): boolean {
  const { lastSuccessTimestamp, lastAttemptTimestamp } = getRiotApiHealth();
  if (lastAttemptTimestamp === undefined) return false;
  const attemptRecent = now - lastAttemptTimestamp < attemptWindowMs;
  return lastSuccessTimestamp === undefined
    ? attemptRecent
    : lastAttemptTimestamp > lastSuccessTimestamp &&
        attemptRecent &&
        now - lastSuccessTimestamp > successStaleMs;
}

export type HealthRouteOptions = {
  readonly cors: Record<string, string>;
  /** Overridden by tests; defaults to this process's own start time. */
  readonly startedAt?: number;
  readonly now?: number;
};

/**
 * Liveness: fail only on a condition a restart actually fixes.
 *
 * Two such conditions exist. The Riot client can wedge in a way that only a
 * fresh process clears, and — since 2026-09-01 — so can the Discord gateway:
 * a shard that stops receiving heartbeat acknowledgements keeps every other
 * signal green (REST works, `discord_connection_status` reads 1, the reported
 * latency freezes on its last healthy value) while every slash command in
 * every guild answers "The application did not respond".
 */
export function handleLivez({
  cors,
  startedAt = applicationStartTime,
  now = Date.now(),
}: HealthRouteOptions): Response {
  const { lastSuccessTimestamp = null, lastAttemptTimestamp = null } =
    getRiotApiHealth();
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

  // After grace: unhealthy if a failing attempt is under 20 min old AND the
  // last success is over 15 min old
  const riotApiHealthy = !riotApiFailing(now, 20 * 60 * 1000, 15 * 60 * 1000);

  const discordGateway = evaluateDiscordGatewayLiveness({
    now,
    uptimeMs,
    startupGraceMs: STARTUP_GRACE_PERIOD_MS,
    health: getDiscordGatewayHealth(),
  });

  const healthy = riotApiHealthy && discordGateway.live;

  return Response.json(
    {
      healthy,
      lastSuccessTimestamp,
      lastAttemptTimestamp,
      uptimeMs,
      components: { riotApiHealthy, discordGateway },
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Content-Type": "application/json", ...cors },
    },
  );
}

/**
 * Readiness: whether this replica should receive traffic.
 *
 * The gateway is reported here but deliberately does not gate the status.
 * Removing the only replica from the Service would take the web app and tRPC
 * down as well, which is strictly worse than a bot that cannot hear Discord.
 */
export function handleHealthz({
  cors,
  startedAt = applicationStartTime,
  now = Date.now(),
}: HealthRouteOptions): Response {
  const { lastSuccessTimestamp = null, lastAttemptTimestamp = null } =
    getRiotApiHealth();
  const uptimeSeconds = (now - startedAt) / 1000;

  // Unhealthy if a failing attempt is under 10 min old AND the last success
  // is over 5 min old
  const healthy = !riotApiFailing(now, 10 * 60 * 1000, 5 * 60 * 1000);

  return Response.json(
    {
      healthy,
      lastSuccessTimestamp,
      lastAttemptTimestamp,
      uptimeSeconds,
      components: {
        temporal: getScoutTemporalHealth(),
        discordGateway: getDiscordGatewayHealth(),
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Content-Type": "application/json", ...cors },
    },
  );
}
