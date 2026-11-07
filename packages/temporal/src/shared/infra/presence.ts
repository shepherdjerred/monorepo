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

// Desired front-door lock state as a pure function of household presence.
// Lock only when nobody is in the home zone. `"home"` is the sole occupied
// state; every other value (`"not_home"`, a named zone like `"Work"`, or
// `"unknown"`) counts as away. Used by the reconcileLock workflow so the lock
// is driven by settled occupancy rather than by individual presence edges.
export function shouldLock(personStates: readonly string[]): boolean {
  return personStates.every((state) => state !== "home");
}

// Whether a person entity positively reports being outside the home zone:
// `"not_home"` or a named zone such as `"Work"`. Unlike `shouldLock`, an
// unresolved tracker (`"unknown"` / `"unavailable"`, e.g. during an HA
// restart) does NOT count as away — starting the vacuums on a person we cannot
// locate is the unsafe direction, whereas locking the door is the safe one.
export function isConfirmedAway(personState: string): boolean {
  return (
    personState !== "home" &&
    personState !== "unknown" &&
    personState !== "unavailable"
  );
}
