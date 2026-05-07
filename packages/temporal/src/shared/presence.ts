// Cooldown window for the welcomeHome / leavingHome event-driven workflows.
// HA presence (GPS / wifi / cell-tower) routinely flaps a few seconds across
// the home zone boundary while the user is stationary. The same value is used
// in two places:
//   1. Trigger handler (event-bridge/triggers.ts) buckets the workflow id by
//      this window so duplicate starts inside it are dropped server-side.
//   2. Workflow body (workflows/ha/{leaving-home,welcome-home}.ts) sleeps for
//      this long and rechecks presence — a single false transition exits
//      without notifying / locking / vacuuming.
export const PRESENCE_COOLDOWN_SECONDS = 90;

export function cooldownBucket(nowMs: number = Date.now()): string {
  return String(Math.floor(nowMs / (PRESENCE_COOLDOWN_SECONDS * 1000)));
}
