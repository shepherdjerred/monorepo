import {
  deprecatePatch,
  getExternalWorkflowHandle,
  isCancellation,
} from "@temporalio/workflow";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutStage } from "#src/contracts.ts";
import {
  ScoutClientMatchDispatchResultSchema,
  type ScoutClientMatchDispatchItem,
} from "#src/workflow-contracts.ts";
import { scoutClientMatchDispatchCompletedSignal } from "#src/signals.ts";
import { realtimePipelineActivities } from "#src/workflows/activity-options.ts";

/**
 * Retired beta-only gates. Prod never evaluated them, so prod histories carry
 * no marker and prod still records none. Every beta run that could take the
 * old branch has closed. Remove the `deprecatePatch` calls in a release after
 * this one.
 */
export const SCOUT_HISTORY_DISPATCH_BACKGROUND_PATCH =
  "scout-history-dispatch-background";
export const SCOUT_DISCOVERED_HISTORY_ANCHOR_PATCH =
  "scout-discovered-history-anchor";

/** Only old signal histories infer this fact from their acknowledgement targets. */
export function clientDispatchHasOrderingAssurance(
  match: ScoutClientMatchDispatchItem,
): boolean {
  return match.orderingAssured ?? match.completionTargets.length > 0;
}

export async function acknowledgeClientDispatch(
  match: ScoutClientMatchDispatchItem,
  result: {
    readonly outcome:
      "processed" | "history-queued" | "already-complete" | "terminal-failure";
    readonly failureType?: string;
  },
): Promise<void> {
  const signal = ScoutClientMatchDispatchResultSchema.parse({
    riotMatchId: match.riotMatchId,
    ...result,
  });
  for (const target of match.completionTargets) {
    try {
      await getExternalWorkflowHandle(target.workflowId, target.runId).signal(
        scoutClientMatchDispatchCompletedSignal,
        signal,
      );
    } catch (error) {
      if (isCancellation(error)) throw error;
      // A terminated requesting run must not strand subsequent matches.
    }
  }
}

/** Historical evidence leaves the ordered queue only after durable admission and acknowledgement. */
export async function queueNextHistoricalMatch(
  stage: ScoutStage,
  pending: Map<RiotMatchId, ScoutClientMatchDispatchItem>,
  lateArrivals: Map<RiotMatchId, ScoutClientMatchDispatchItem>,
): Promise<boolean> {
  if (stage !== "beta") return false;
  deprecatePatch(SCOUT_HISTORY_DISPATCH_BACKGROUND_PATCH);
  const history = [...pending.values(), ...lateArrivals.values()].find(
    (item) => item.deliveryMode === "silent-backfill",
  );
  if (history === undefined) return false;
  await realtimePipelineActivities(stage).queueHistoryMatch({
    stage,
    riotMatchId: history.riotMatchId,
    gameEndTimestamp: history.gameEndTimestamp,
  });
  await acknowledgeClientDispatch(history, { outcome: "history-queued" });
  pending.delete(history.riotMatchId);
  lateArrivals.delete(history.riotMatchId);
  return true;
}

/** Later confirmed listing may establish an anchor for an already completed client result. */
export async function advanceDiscoveredHistoryAnchor(
  stage: ScoutStage,
  match: ScoutClientMatchDispatchItem,
): Promise<void> {
  if (stage !== "beta") return;
  deprecatePatch(SCOUT_DISCOVERED_HISTORY_ANCHOR_PATCH);
  if (clientDispatchHasOrderingAssurance(match))
    await realtimePipelineActivities(stage).advanceMatchCursor({
      stage,
      riotMatchId: match.riotMatchId,
    });
}
