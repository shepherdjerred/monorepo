import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  handleHealthz,
  handleLivez,
  STARTUP_GRACE_PERIOD_MS,
} from "#src/http/health-routes.ts";
import { updateRiotApiHealth } from "#src/metrics/index.ts";
import {
  GATEWAY_HEARTBEAT_STALE_AFTER_MS,
  recordDiscordGatewayHeartbeat,
  resetDiscordGatewayHealthForTest,
  setDiscordGatewayState,
} from "#src/metrics/platform/discord-gateway-health.ts";

const CORS = {};
/** Well past the grace period, so the probe evaluates its components. */
const UPTIME_MS = STARTUP_GRACE_PERIOD_MS + 60_000;

function livez(now: number): Response {
  return handleLivez({ cors: CORS, now, startedAt: now - UPTIME_MS });
}

/** Record a successful Riot call, then a failing one `failedAfterMs` later. */
function riotFailsAfterSuccess(successAt: number, failedAfterMs: number): void {
  vi.setSystemTime(successAt);
  updateRiotApiHealth(true);
  vi.setSystemTime(successAt + failedAfterMs);
  updateRiotApiHealth(false);
  vi.useRealTimers();
}

afterEach(() => {
  vi.useRealTimers();
});

/** Put both non-gateway components in their healthy state. */
function healthyBaseline(now: number): void {
  updateRiotApiHealth(true);
  resetDiscordGatewayHealthForTest();
  setDiscordGatewayState("connected");
  recordDiscordGatewayHeartbeat(now - 30_000);
}

describe("/livez", () => {
  beforeEach(() => {
    healthyBaseline(Date.now());
  });

  test("passes unconditionally inside the startup grace period", async () => {
    const now = Date.now();
    setDiscordGatewayState("connecting");

    const response = handleLivez({
      cors: CORS,
      now,
      startedAt: now - (STARTUP_GRACE_PERIOD_MS - 1),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      healthy: true,
      reason: "startup-grace-period",
    });
  });

  test("is healthy while the Riot API answers and the gateway beats", async () => {
    const response = livez(Date.now());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      healthy: true,
      components: {
        riotApiHealthy: true,
        discordGateway: { live: true, reason: "heartbeat-fresh" },
      },
    });
  });

  test("fails when recent Riot calls are being attempted but none succeed", async () => {
    const start = Date.now();
    vi.useFakeTimers();
    riotFailsAfterSuccess(start, 10 * 60 * 1000);
    const now = start + 16 * 60 * 1000;
    recordDiscordGatewayHeartbeat(now - 30_000);

    const response = livez(now);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      healthy: false,
      components: { riotApiHealthy: false },
    });
  });

  test("stays healthy while idle after a successful Riot call", async () => {
    // The web role calls Riot only on user actions; a quiet stretch after a
    // success is not a wedged client and must not restart the pod.
    const now = Date.now() + 16 * 60 * 1000;
    recordDiscordGatewayHeartbeat(now - 30_000);

    const response = livez(now);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      components: { riotApiHealthy: true },
    });
  });

  test("fails once the gateway stops acknowledging heartbeats", async () => {
    // The beta outage in one assertion: nothing else about the process is
    // wrong, and the pod must still be restarted — a zombie gateway answers
    // every slash command with "The application did not respond" and never
    // recovers on its own.
    const now = Date.now();
    resetDiscordGatewayHealthForTest();
    setDiscordGatewayState("connected");
    recordDiscordGatewayHeartbeat(now - GATEWAY_HEARTBEAT_STALE_AFTER_MS - 1);

    const response = livez(now);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      healthy: false,
      components: {
        riotApiHealthy: true,
        discordGateway: { live: false, reason: "heartbeat-stale" },
      },
    });
  });

  test("stays healthy when the gateway was never started", async () => {
    // `dev:web --no-discord-gateway` and NODE_ENV=test never log in.
    const now = Date.now();
    resetDiscordGatewayHealthForTest();
    setDiscordGatewayState("disabled");

    const response = livez(now);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      healthy: true,
      components: { discordGateway: { reason: "gateway-disabled" } },
    });
  });
});

describe("/healthz", () => {
  beforeEach(() => {
    healthyBaseline(Date.now());
  });

  test("is ready while the Riot API is answering", async () => {
    const now = Date.now();

    const response = handleHealthz({
      cors: CORS,
      now,
      startedAt: now - UPTIME_MS,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ healthy: true });
  });

  test("goes unready on a shorter Riot staleness window than liveness", async () => {
    // Readiness pulls this replica out of the Service after 5 minutes;
    // liveness waits 15 before restarting it.
    const start = Date.now();
    vi.useFakeTimers();
    riotFailsAfterSuccess(start, 4 * 60 * 1000);
    const now = start + 6 * 60 * 1000;
    recordDiscordGatewayHeartbeat(now - 30_000);

    const response = handleHealthz({
      cors: CORS,
      now,
      startedAt: now - UPTIME_MS,
    });

    expect(response.status).toBe(503);
    expect(livez(now).status).toBe(200);
  });

  test("stays ready while idle after a successful Riot call", () => {
    const now = Date.now() + 6 * 60 * 1000;

    const response = handleHealthz({
      cors: CORS,
      now,
      startedAt: now - UPTIME_MS,
    });

    expect(response.status).toBe(200);
  });

  test("stays ready with a dead gateway, which liveness alone acts on", async () => {
    // Removing the only replica from the Service would take the web app and
    // tRPC down with the bot; a restart is the narrower remedy.
    const now = Date.now();
    resetDiscordGatewayHealthForTest();
    setDiscordGatewayState("connected");
    recordDiscordGatewayHeartbeat(now - GATEWAY_HEARTBEAT_STALE_AFTER_MS - 1);

    const response = handleHealthz({
      cors: CORS,
      now,
      startedAt: now - UPTIME_MS,
    });

    expect(response.status).toBe(200);
    expect(livez(now).status).toBe(503);
  });
});
