import type { RegressionAction } from "#learning/native/regression-client.ts";

export function emptyInference() {
  return {
    submitted: 0,
    skipped: 0,
    timely: 0,
    stale: 0,
    expired: 0,
    contextDrops: 0,
    deadlineMet: 0,
    deadlineMissed: 0,
    resets: 0,
    rejected: 0,
    hits: 0,
    misses: 0,
    maximumNanos: 0,
    maximumBatch: 0,
  };
}

/** Synthetic fixture values only; these actions never establish native acceptance. */
export function unavailableAction(
  match: string,
  body: string,
  targetBody: string,
  authored: string[],
): RegressionAction {
  return {
    sequence: 2,
    serverTick: 100,
    botTick: 10,
    match,
    body,
    life: 0,
    kit: "TROOPER",
    decision: "unavailable",
    heldSlot: 1,
    usingItem: false,
    targetId: 2,
    targetBody,
    x: 2,
    y: 65,
    z: 3,
    health: 20,
    absorption: 0,
    authored,
    commands: [...authored],
    ticket: null,
  };
}
