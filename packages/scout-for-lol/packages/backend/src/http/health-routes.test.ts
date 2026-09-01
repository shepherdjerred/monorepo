import { beforeEach, describe, expect, test } from "vitest";
import {
  handleHealthz,
  handleLivez,
  STARTUP_GRACE_PERIOD_MS,
} from "#src/http/health-routes.ts";
import { updateRiotApiHealth } from "#src/metrics/index.ts";

const CORS = {};
/** Well past the grace period, so the probe evaluates its components. */
const UPTIME_MS = STARTUP_GRACE_PERIOD_MS + 60_000;

describe("/livez", () => {
  beforeEach(() => {
    updateRiotApiHealth(true);
  });

  test("passes unconditionally inside the startup grace period", async () => {
    const now = Date.now();

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

  test("is healthy while the Riot API is answering", async () => {
    const now = Date.now();

    const response = handleLivez({
      cors: CORS,
      now,
      startedAt: now - UPTIME_MS,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ healthy: true });
  });

  test("fails when recent Riot calls are being attempted but none succeed", async () => {
    // `updateRiotApiHealth` stamps both clocks with the current time, so the
    // failure is expressed by reading the probe from far enough in the future
    // that the last success is stale while the last attempt is not.
    const now = Date.now() + 16 * 60 * 1000;

    const response = handleLivez({
      cors: CORS,
      now,
      startedAt: now - UPTIME_MS,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      healthy: false,
      components: { riotApiHealthy: false },
    });
  });
});

describe("/healthz", () => {
  beforeEach(() => {
    updateRiotApiHealth(true);
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
    const now = Date.now() + 6 * 60 * 1000;

    const response = handleHealthz({
      cors: CORS,
      now,
      startedAt: now - UPTIME_MS,
    });

    expect(response.status).toBe(503);
    expect(
      handleLivez({ cors: CORS, now, startedAt: now - UPTIME_MS }).status,
    ).toBe(200);
  });
});
