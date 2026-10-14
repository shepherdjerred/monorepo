import {
  getExternalWorkflowHandle,
  isCancellation,
  patched,
} from "@temporalio/workflow";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutStage } from "#src/contracts.ts";
import {
  ScoutClientMatchDispatchResultSchema,
  type ScoutClientMatchDispatchItem,
} from "#src/workflow-contracts.ts";
import { scoutClientMatchDispatchCompletedSignal } from "#src/signals.ts";
import { realtimePipelineActivities } from "./activity-options.ts";

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
  if (stage !== "beta" || !patched("scout-history-dispatch-background"))
    return false;
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
  if (
    stage === "beta" &&
    patched("scout-discovered-history-anchor") &&
    clientDispatchHasOrderingAssurance(match)
  )
    await realtimePipelineActivities(stage).advanceMatchCursor({
      stage,
      riotMatchId: match.riotMatchId,
    });
}
