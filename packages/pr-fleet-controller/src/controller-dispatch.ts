import type { FleetStore } from "./state.ts";

export function busyStackIds(store: FleetStore): Set<string> {
  const busy = new Set<string>();
  for (const state of store.prs.values()) {
    if (
      store.activeWorkers.has(state.identity.number) ||
      state.status === "waiting-for-answer"
    ) {
      busy.add(state.stackId);
    }
  }
  return busy;
}
