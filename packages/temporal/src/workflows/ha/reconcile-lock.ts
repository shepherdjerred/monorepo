import { condition, defineSignal, setHandler } from "@temporalio/workflow";
import { callServiceUnchecked, getEntityStateUnchecked } from "./util.ts";
import { PRESENCE_COOLDOWN_SECONDS, shouldLock } from "#shared/presence.ts";

const FRONT_DOOR_LOCK = "lock.front_door" as const;
const PERSONS = ["person.jerred", "person.shuxin"] as const;

/**
 * Sent by the trigger handler on every `person.*` home/away transition. Each
 * signal resets the debounce window inside {@link reconcileLock}.
 */
export const presenceChanged = defineSignal("presenceChanged");

/**
 * Singleton, debounced reconciler for the front-door lock.
 *
 * Why a reconciler instead of edge-triggered lock/unlock workflows: HA presence
 * (GPS / wifi / cell-tower) flaps across the home boundary while people are
 * stationary. The previous design fired an independent unlock workflow on every
 * `not_home → home` edge and an independent lock workflow on every last
 * `home → not_home` edge; both ran on their own 90s timers, sampled occupancy
 * once, never cancelled each other, and always actuated the bolt — so a single
 * flap cycle produced an audible unlock-then-lock even when nobody moved.
 *
 * This workflow is started/signalled with a fixed workflow id
 * (`reconcile-lock`), so only one runs at a time. It:
 *   1. Debounces — blocks until presence has been quiet for a full
 *      {@link PRESENCE_COOLDOWN_SECONDS} window; every {@link presenceChanged}
 *      signal restarts the wait. Reaching the end of the wait means no presence
 *      edge fired for the whole window, i.e. the household has settled.
 *   2. Computes the desired lock state as a pure function of who is home
 *      ({@link shouldLock}) from a fresh, authoritative read of live state.
 *   3. Actuates only when current ≠ desired — idempotent, so a redundant
 *      trigger never clunks the bolt.
 */
export async function reconcileLock(): Promise<void> {
  // Monotonic count of presence edges received. Comparing snapshots of this
  // counter detects "a new edge arrived" across `await` boundaries without
  // relying on a boolean the control-flow analyzer would narrow to a literal.
  let edges = 0;
  setHandler(presenceChanged, () => {
    edges += 1;
  });

  for (;;) {
    // Debounce: wait until a full window passes with no new presence edge.
    // Each edge bumps `edges`, which resolves the condition and restarts the
    // wait. The wait only times out once the household has settled.
    let seen = edges;
    while (
      await condition(() => edges !== seen, PRESENCE_COOLDOWN_SECONDS * 1000)
    ) {
      seen = edges;
    }

    // Settled — decide from live state, not from the triggering edge.
    const states = await Promise.all(
      PERSONS.map((person) => getEntityStateUnchecked(person)),
    );
    const desiredLocked = shouldLock(states.map((state) => state.state));

    const lock = await getEntityStateUnchecked(FRONT_DOOR_LOCK);
    const currentLocked = lock.state === "locked";

    if (currentLocked === desiredLocked) {
      console.warn(
        JSON.stringify({
          level: "info",
          msg: "reconcileLock: already in desired state",
          component: "ha-presence",
          workflow: "reconcileLock",
          phase: "noop",
          desiredLocked,
        }),
      );
    } else {
      await callServiceUnchecked("lock", desiredLocked ? "lock" : "unlock", {
        entity_id: FRONT_DOOR_LOCK,
      });
      console.warn(
        JSON.stringify({
          level: "info",
          msg: `reconcileLock: ${desiredLocked ? "locked" : "unlocked"} front door`,
          component: "ha-presence",
          workflow: "reconcileLock",
          phase: "actuated",
          desiredLocked,
        }),
      );
    }

    // A presence edge during the reconcile read re-arms the debounce; loop and
    // settle again. Otherwise we're done and the workflow exits, so the next
    // edge starts a fresh run via signalWithStart.
    if (edges !== seen) {
      continue;
    }
    return;
  }
}
