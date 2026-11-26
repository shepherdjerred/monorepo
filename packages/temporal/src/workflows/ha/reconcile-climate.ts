import { condition, defineSignal, setHandler } from "@temporalio/workflow";
import { PRESENCE_COOLDOWN_SECONDS } from "#shared/infra/presence.ts";
import { applyHomeClimate } from "./climate-apply.ts";

/**
 * Sent on every person home/away transition and on event-bridge reconnect.
 * Each signal restarts the debounce inside {@link reconcileClimate}.
 */
export const presenceChanged = defineSignal("presenceChanged");

/**
 * Singleton reconciler for living-room and bedroom heat. Same shape as
 * reconcileLock: one workflow id, a 90s quiet window, then a decision from
 * live state rather than from the triggering edge.
 */
export async function reconcileClimate(): Promise<void> {
  let edges = 0;
  setHandler(presenceChanged, () => {
    edges += 1;
  });

  for (;;) {
    let seen = edges;
    while (
      await condition(() => edges !== seen, PRESENCE_COOLDOWN_SECONDS * 1000)
    ) {
      seen = edges;
    }

    await applyHomeClimate();

    if (edges !== seen) continue;
    return;
  }
}
