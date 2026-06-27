/**
 * Pure loop-policy for the babysitter: given the current verdict + budget +
 * accumulated state, decide what the loop should do next. Kept pure and
 * import-clean so it is unit-testable and reusable by both the local PoC driver
 * and the (future) Temporal workflow.
 */
import { failureSignature } from "./prompt.ts";
import type { BabysitVerdict, PrBabysitBudget } from "./types.ts";

export type BudgetState = {
  iterationsTotal: number;
  costUsd: number;
  elapsedMinutes: number;
  /** Failure signatures of prior iterations, oldest→newest. */
  recentSignatures: readonly string[];
};

export type LoopDecisionKind =
  | "done" // DoD met
  | "closed" // PR closed/merged — nothing to babysit
  | "standdown" // budget exhausted or stuck
  | "wait" // only pending CI remains — wait, don't burn an agent turn
  | "act"; // a real failure to fix — run an iteration

export type LoopDecision = {
  kind: LoopDecisionKind;
  reason?: string;
};

/**
 * How many trailing iterations share the current failure signature. Used by the
 * stuck-loop guard: if we've already tried the same failure `stuckThreshold`
 * times without it changing, stop.
 */
function trailingRepeatCount(
  recent: readonly string[],
  signature: string,
): number {
  let count = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (recent[i] === signature) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

/** True when the only thing keeping the PR from green is still-running CI. */
export function onlyPendingCi(verdict: BabysitVerdict): boolean {
  return (
    verdict.ci.failing.length === 0 &&
    verdict.ci.pending.length > 0 &&
    verdict.conflicts.clean &&
    verdict.reviews.allResolved
  );
}

export function decideNextAction(
  verdict: BabysitVerdict,
  budget: PrBabysitBudget,
  state: BudgetState,
): LoopDecision {
  if (verdict.prState !== "open") {
    return { kind: "closed", reason: `pr ${verdict.prState}` };
  }
  if (verdict.dodMet) {
    return { kind: "done" };
  }
  if (state.iterationsTotal >= budget.maxIterations) {
    return {
      kind: "standdown",
      reason: `max iterations (${String(budget.maxIterations)}) reached`,
    };
  }
  if (state.elapsedMinutes >= budget.maxWallClockMinutes) {
    return {
      kind: "standdown",
      reason: `wall-clock budget (${String(budget.maxWallClockMinutes)}m) reached`,
    };
  }
  if (state.costUsd >= budget.maxCostUsd) {
    return {
      kind: "standdown",
      reason: `cost budget ($${String(budget.maxCostUsd)}) reached`,
    };
  }
  // Only still-running CI: wait rather than spend an agent turn.
  if (onlyPendingCi(verdict)) {
    return { kind: "wait", reason: "ci pending" };
  }
  // Stuck guard: same failure tried too many times.
  const signature = failureSignature(verdict);
  if (
    trailingRepeatCount(state.recentSignatures, signature) >=
    budget.stuckThreshold
  ) {
    return {
      kind: "standdown",
      reason: `stuck: same failure ${String(budget.stuckThreshold)}× (${signature.slice(0, 80)})`,
    };
  }
  return { kind: "act" };
}
