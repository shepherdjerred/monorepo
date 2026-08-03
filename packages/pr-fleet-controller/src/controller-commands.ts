import type { FleetStore } from "./state.ts";

function requireKnownPr(store: FleetStore, prNumber: number): void {
  if (!store.prs.has(prNumber)) {
    throw new Error(`Unknown PR #${String(prNumber)}`);
  }
}

export function prioritizePr(
  store: FleetStore,
  prNumber: number,
  priority: number,
): void {
  const state = store.prs.get(prNumber);
  if (state === undefined) {
    throw new Error(`Unknown PR #${String(prNumber)}`);
  }
  store.prs.set(prNumber, { ...state, priority });
}

export function resumePr(store: FleetStore, prNumber: number): void {
  requireKnownPr(store, prNumber);
  store.pausedReasons.delete(prNumber);
}

export function guidePr(
  store: FleetStore,
  prNumber: number,
  message: string,
): void {
  requireKnownPr(store, prNumber);
  store.addGuidance(prNumber, message);
}

export function updateWorkerLimit(store: FleetStore, limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new Error("Worker limit must be an integer between one and five");
  }
  store.workerLimit = limit;
}
