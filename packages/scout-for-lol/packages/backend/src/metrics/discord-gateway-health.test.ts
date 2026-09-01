import { beforeEach, describe, expect, test } from "vitest";
import {
  GATEWAY_HEARTBEAT_STALE_AFTER_MS,
  evaluateDiscordGatewayLiveness,
  getDiscordGatewayHealth,
  recordDiscordGatewayHeartbeat,
  resetDiscordGatewayHealthForTest,
  setDiscordGatewayState,
  type DiscordGatewayHealth,
} from "#src/metrics/discord-gateway-health.ts";

const NOW = 1_800_000_000_000;
const GRACE_MS = 5 * 60 * 1000;

function health(
  overrides: Partial<DiscordGatewayHealth> = {},
): DiscordGatewayHealth {
  return {
    state: "connected",
    lastHeartbeatAckTimestamp: NOW,
    lastCloseReason: undefined,
    ...overrides,
  };
}

describe("gateway heartbeat state", () => {
  beforeEach(() => {
    resetDiscordGatewayHealthForTest();
  });

  test("keeps the newest acknowledgement across shards", () => {
    recordDiscordGatewayHeartbeat(NOW);
    recordDiscordGatewayHeartbeat(NOW - 10_000);

    expect(getDiscordGatewayHealth().lastHeartbeatAckTimestamp).toBe(NOW);
  });

  test("ignores discord.js's -1 placeholder for a shard that never beat", () => {
    // WebSocketShard#lastPingTimestamp starts at -1. Treating that as a real
    // timestamp would report an acknowledgement from 1970 and fail liveness
    // the instant the grace period ended.
    recordDiscordGatewayHeartbeat(-1);

    expect(getDiscordGatewayHealth().lastHeartbeatAckTimestamp).toBeUndefined();
  });

  test("records the close reason alongside the state", () => {
    setDiscordGatewayState("disconnected", "close 1006 ");

    expect(getDiscordGatewayHealth()).toMatchObject({
      state: "disconnected",
      lastCloseReason: "close 1006 ",
    });
  });
});

describe("evaluateDiscordGatewayLiveness", () => {
  test("passes when the gateway was never started", () => {
    // `dev:web --no-discord-gateway` and NODE_ENV=test never log in, and must
    // not be restarted for a heartbeat they were never going to receive.
    expect(
      evaluateDiscordGatewayLiveness({
        now: NOW,
        uptimeMs: 24 * 60 * 60 * 1000,
        startupGraceMs: GRACE_MS,
        health: health({
          state: "disabled",
          lastHeartbeatAckTimestamp: undefined,
        }),
      }),
    ).toEqual({
      live: true,
      reason: "gateway-disabled",
      heartbeatAgeMs: undefined,
    });
  });

  test("passes while connecting inside the startup grace period", () => {
    expect(
      evaluateDiscordGatewayLiveness({
        now: NOW,
        uptimeMs: GRACE_MS - 1,
        startupGraceMs: GRACE_MS,
        health: health({
          state: "connecting",
          lastHeartbeatAckTimestamp: undefined,
        }),
      }),
    ).toMatchObject({ live: true, reason: "startup-grace-period" });
  });

  test("fails when the grace period elapsed without a single acknowledgement", () => {
    expect(
      evaluateDiscordGatewayLiveness({
        now: NOW,
        uptimeMs: GRACE_MS,
        startupGraceMs: GRACE_MS,
        health: health({
          state: "connecting",
          lastHeartbeatAckTimestamp: undefined,
        }),
      }),
    ).toMatchObject({ live: false, reason: "heartbeat-never-received" });
  });

  test("passes on a fresh acknowledgement", () => {
    expect(
      evaluateDiscordGatewayLiveness({
        now: NOW,
        uptimeMs: 60 * 60 * 1000,
        startupGraceMs: GRACE_MS,
        health: health({ lastHeartbeatAckTimestamp: NOW - 40_000 }),
      }),
    ).toEqual({
      live: true,
      reason: "heartbeat-fresh",
      heartbeatAgeMs: 40_000,
    });
  });

  test("fails once acknowledgements stop, even while the client reports connected", () => {
    // This is the beta outage: shard state stayed `connected` and REST kept
    // working while every interaction timed out.
    const stale = GATEWAY_HEARTBEAT_STALE_AFTER_MS + 1;

    expect(
      evaluateDiscordGatewayLiveness({
        now: NOW,
        uptimeMs: 2 * 60 * 60 * 1000,
        startupGraceMs: GRACE_MS,
        health: health({ lastHeartbeatAckTimestamp: NOW - stale }),
      }),
    ).toEqual({
      live: false,
      reason: "heartbeat-stale",
      heartbeatAgeMs: stale,
    });
  });

  test("tolerates an ordinary reconnect that is still beating", () => {
    // A shard passes through `disconnected` for a few seconds on every
    // resume; restarting the pod for that would be worse than waiting.
    expect(
      evaluateDiscordGatewayLiveness({
        now: NOW,
        uptimeMs: 2 * 60 * 60 * 1000,
        startupGraceMs: GRACE_MS,
        health: health({
          state: "disconnected",
          lastHeartbeatAckTimestamp: NOW - 5000,
        }),
      }),
    ).toMatchObject({ live: true, reason: "heartbeat-fresh" });
  });

  test("is not tripped by a clock that moved backwards", () => {
    expect(
      evaluateDiscordGatewayLiveness({
        now: NOW,
        uptimeMs: 2 * 60 * 60 * 1000,
        startupGraceMs: GRACE_MS,
        health: health({ lastHeartbeatAckTimestamp: NOW + 5000 }),
      }),
    ).toEqual({ live: true, reason: "heartbeat-fresh", heartbeatAgeMs: 0 });
  });
});
