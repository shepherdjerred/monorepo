import type { PromotionRunInput } from "#shared/promotion/model.ts";
import {
  updatePromotionState,
  type PromotionStore,
} from "#activities/promotion/store.ts";

/** Count actual executor outcomes, never previews, cooldown skips or read failures. */
export async function recordPromotionExecutionHealth(input: {
  store: PromotionStore;
  targetId: string;
  occurrenceId: string;
  mode: PromotionRunInput["mode"];
  outcome: "success" | "failure" | "skip";
}) {
  if (input.outcome === "skip" || input.mode === "preview") return;
  if (input.mode === "reconcile" && input.outcome !== "success") return;
  await updatePromotionState(input.store, input.targetId, (state) => {
    if (
      state.executionHealth.lastOccurrenceId === input.occurrenceId &&
      (input.outcome === "failure" ||
        state.executionHealth.consecutiveFailures === 0)
    )
      return state;
    return {
      ...state,
      executionHealth: {
        consecutiveFailures:
          input.outcome === "success"
            ? 0
            : state.executionHealth.consecutiveFailures + 1,
        lastOccurrenceId: input.occurrenceId,
      },
    };
  });
}
