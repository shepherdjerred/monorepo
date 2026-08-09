/** Gateway connection tracking, kept separate from the client so the liveness
 *  decision is a pure function that can be tested without a live Discord
 *  connection. */

/** How long the gateway may stay down before the process is considered wedged.
 *
 *  The failure this exists for: `client.login()` runs once at startup and
 *  discord.js reconnects internally, so a process whose gateway has died stays
 *  alive and healthy-looking forever while silently serving nobody. Five
 *  minutes is comfortably longer than discord.js's own backoff, so ordinary
 *  reconnects never trip it, but short enough that a wedged pod recycles
 *  promptly. */
export const GATEWAY_GRACE_MS = 5 * 60 * 1000;

/** Decide liveness from how long the gateway has been down.
 *
 *  Returning `false` makes the kubelet restart the pod, so this is deliberately
 *  the only condition that does: a database blip should make the pod
 *  *unready*, not recycle it. */
export function isLive(downForMs: number): boolean {
  return downForMs < GATEWAY_GRACE_MS;
}

/** Timestamp the gateway went down, or `null` while connected.
 *
 *  Seeded at module load rather than `null`: "never connected" must count as
 *  down, otherwise a process whose very first login never succeeds would report
 *  live forever and never be restarted. */
let disconnectedSince: number | null = Date.now();

export function markGatewayConnected(): void {
  disconnectedSince = null;
}

export function markGatewayDisconnected(now: number = Date.now()): void {
  // Keep the earliest timestamp so repeated disconnect events do not keep
  // resetting the grace window.
  disconnectedSince ??= now;
}

export function gatewayDownForMs(now: number = Date.now()): number {
  return disconnectedSince === null ? 0 : now - disconnectedSince;
}

export function isGatewayConnected(): boolean {
  return disconnectedSince === null;
}

/** Test-only reset so cases do not leak state into each other. */
export function resetGatewayStateForTest(value: number | null): void {
  disconnectedSince = value;
}
