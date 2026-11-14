import type { PromotionBatch } from "@shepherdjerred/ops-model/promotion/model.ts";
import type {
  PromotionState,
  PromotionTarget,
} from "#shared/promotion/model.ts";
import {
  promotionFailurePause,
  promotionRunBlocked,
} from "#shared/promotion/model.ts";
import { promotionWindow } from "#shared/promotion/cadence.ts";

export type PromotionPlanningObservation = {
  available: boolean;
  enabled: boolean;
  enabledTargets: string[];
  schedule:
    | { status: "active"; times: string[] }
    | { status: "paused" | "unavailable" | "exhausted" };
};

const none = (nextPlannedReason: string) => ({
  nextPlannedAt: null,
  nextPlannedReason,
});

function heldReason(target: PromotionTarget, state: PromotionState) {
  if (target.action === "pending" || target.action === "inspect")
    return "Setup required";
  if (state.attempts.some((attempt) => attempt.status === "uncertain"))
    return "Awaiting reconciliation";
  if (state.paused || promotionFailurePause(state) !== null) return "Paused";
  return promotionRunBlocked(state) ? "Awaiting cooldown deadline" : null;
}

function activeReason(batches: PromotionBatch[], targetId: string) {
  const active = batches.flatMap((batch) =>
    batch.finishedAt === null && batch.interrupted !== true
      ? batch.entries.filter(
          (entry) =>
            entry.targetId === targetId &&
            (entry.effectiveMode ?? batch.mode) === "run" &&
            (entry.status === "queued" || entry.status === "running"),
        )
      : [],
  );
  if (active.some((entry) => entry.status === "running")) return "In progress";
  return active.length > 0 ? "Queued" : null;
}

/** Read-only forecast of a dispatch opportunity, never a reservation or eligibility override. */
export function promotionNextPlanned(input: {
  target: PromotionTarget;
  state: PromotionState;
  batches: PromotionBatch[];
  now: number;
  planning?: PromotionPlanningObservation;
}) {
  const { target, state, planning, now } = input;
  const held = heldReason(target, state);
  if (held !== null) return none(held);
  const active = activeReason(input.batches, target.id);
  if (active !== null) return none(active);
  if (state.lock !== null) return none("Awaiting owner settlement");
  if (planning === undefined) return none("Schedule unavailable");
  if (!planning.available) return none("Configuration unavailable");
  if (!planning.enabled) return none("Automation disabled");
  if (!planning.enabledTargets.includes(target.id)) return none("Not enabled");
  if (planning.schedule.status === "paused") return none("Schedule paused");
  if (planning.schedule.status === "exhausted")
    return none("Schedule action limit reached");
  if (planning.schedule.status !== "active")
    return none("Schedule unavailable");
  for (const value of [...planning.schedule.times].sort((a, b) =>
    a.localeCompare(b),
  )) {
    const sweep = Date.parse(value);
    if (sweep < now) continue;
    const window = promotionWindow(target, state, sweep);
    if (window.canDispatch)
      return {
        nextPlannedAt: new Date(Math.max(sweep, window.dueAt)).toISOString(),
        nextPlannedReason: "Expected scheduled opportunity",
      };
  }
  return none("Beyond schedule forecast");
}
