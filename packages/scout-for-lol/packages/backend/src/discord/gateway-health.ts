/**
 * Liveness state for the Discord gateway connection.
 *
 * ## Why this exists
 *
 * On 2026-09-01 the beta bot answered every slash command with "The
 * application did not respond" for over half an hour while looking completely
 * healthy: the pod was running, REST calls kept succeeding (match polling,
 * guild command reconciliation), `discord_connection_status` read 1, and
 * nothing was logged. Discord was dispatching `INTERACTION_CREATE` — a second
 * gateway session opened with the same token received it — but the deployed
 * client's shard had silently stopped receiving anything. Its heartbeat
 * acknowledgements had stopped at 00:50 UTC, which was visible only as
 * `discord_latency_ms` freezing on the exact same value forever, because
 * discord.js only writes `WebSocketShard#ping` when an acknowledgement
 * arrives.
 *
 * A zombie gateway is indistinguishable from a healthy one unless something
 * watches the heartbeat clock, so that clock is what this module owns. The
 * age of the newest acknowledgement — not a boolean the client reports about
 * itself — is the liveness signal, and `/livez` fails on it so Kubernetes
 * restarts the pod instead of leaving a bot that is up but deaf.
 *
 * Staleness alone is the verdict. Shard state is recorded for logs and
 * metrics but deliberately does not gate liveness: an ordinary reconnect
 * passes through `disconnected` for a few seconds, and restarting the pod for
 * that would be worse than waiting. A reconnect that never completes stops
 * advancing the heartbeat clock anyway, so it trips the same threshold.
 */

/** Discord's gateway heartbeat interval is 41.25s; this is three missed beats. */
export const GATEWAY_HEARTBEAT_STALE_AFTER_MS = 3 * 60 * 1000;

export type DiscordGatewayState =
  "disabled" | "connecting" | "connected" | "disconnected";

export type DiscordGatewayHealth = {
  readonly state: DiscordGatewayState;
  /** When the newest heartbeat acknowledgement was sent, or undefined before the first. */
  readonly lastHeartbeatAckTimestamp: number | undefined;
  readonly lastCloseReason: string | undefined;
};

let state: DiscordGatewayState = "connecting";
let lastHeartbeatAckTimestamp: number | undefined;
let lastCloseReason: string | undefined;

export function setDiscordGatewayState(
  next: DiscordGatewayState,
  closeReason?: string,
): void {
  state = next;
  lastCloseReason = closeReason;
}

/**
 * Record the newest heartbeat acknowledgement.
 *
 * discord.js seeds `WebSocketShard#lastPingTimestamp` with -1 and only
 * overwrites it on an acknowledgement, so a non-positive sample means "no beat
 * yet" rather than "a beat at the epoch", and must not be mistaken for one.
 */
export function recordDiscordGatewayHeartbeat(timestamp: number): void {
  if (timestamp <= 0) return;
  if (
    lastHeartbeatAckTimestamp === undefined ||
    timestamp > lastHeartbeatAckTimestamp
  ) {
    lastHeartbeatAckTimestamp = timestamp;
  }
}

export function getDiscordGatewayHealth(): DiscordGatewayHealth {
  return { state, lastHeartbeatAckTimestamp, lastCloseReason };
}

/** Test-only reset; the module state is a process-wide singleton otherwise. */
export function resetDiscordGatewayHealthForTest(): void {
  state = "connecting";
  lastHeartbeatAckTimestamp = undefined;
  lastCloseReason = undefined;
}

export type GatewayLiveness = {
  readonly live: boolean;
  readonly reason:
    | "gateway-disabled"
    | "startup-grace-period"
    | "heartbeat-fresh"
    | "heartbeat-never-received"
    | "heartbeat-stale";
  readonly heartbeatAgeMs: number | undefined;
};

export type EvaluateGatewayLivenessInput = {
  readonly now: number;
  readonly uptimeMs: number;
  readonly startupGraceMs: number;
  readonly health: DiscordGatewayHealth;
  readonly staleAfterMs?: number;
};

/**
 * Decide whether the gateway is live, as a pure function of recorded state.
 *
 * Kept separate from the module singleton so the thresholds can be exercised
 * directly rather than through a fake clock and a live `Client`.
 */
export function evaluateDiscordGatewayLiveness({
  now,
  uptimeMs,
  startupGraceMs,
  health,
  staleAfterMs = GATEWAY_HEARTBEAT_STALE_AFTER_MS,
}: EvaluateGatewayLivenessInput): GatewayLiveness {
  if (health.state === "disabled") {
    return {
      live: true,
      reason: "gateway-disabled",
      heartbeatAgeMs: undefined,
    };
  }

  const { lastHeartbeatAckTimestamp: lastAck } = health;
  if (lastAck === undefined) {
    // Connecting takes a few seconds; a process that has been up for the whole
    // grace period without one acknowledgement never connected at all.
    return uptimeMs < startupGraceMs
      ? {
          live: true,
          reason: "startup-grace-period",
          heartbeatAgeMs: undefined,
        }
      : {
          live: false,
          reason: "heartbeat-never-received",
          heartbeatAgeMs: undefined,
        };
  }

  const heartbeatAgeMs = Math.max(0, now - lastAck);
  return heartbeatAgeMs > staleAfterMs
    ? { live: false, reason: "heartbeat-stale", heartbeatAgeMs }
    : { live: true, reason: "heartbeat-fresh", heartbeatAgeMs };
}
