import { WorkflowNotFoundError } from "@temporalio/client";
import type { PromotionState } from "#shared/promotion.ts";
import { updatePromotionState, type PromotionStore } from "./store.ts";

/** A closed Workflow is evidence; an elapsed lease or quiet agent is not. */
export async function reconcileClosedPromotionOwner(input: {
  store: PromotionStore;
  state: PromotionState;
  ownerRunning: (workflowId: string, runId: string) => Promise<boolean>;
}): Promise<PromotionState> {
  const owner = input.state.lock;
  if (owner === null) return input.state;
  const workflowId = `storm-promotion/${input.state.targetId}`;
  const prefix = `${workflowId}/`;
  if (!owner.occurrenceId.startsWith(prefix))
    throw new Error("Promotion lock has an invalid Workflow identity");
  const runId = owner.occurrenceId.slice(prefix.length);
  try {
    if (await input.ownerRunning(workflowId, runId)) return input.state;
  } catch (error: unknown) {
    if (!(error instanceof WorkflowNotFoundError)) throw error;
    return await updatePromotionState(
      input.store,
      input.state.targetId,
      (state) =>
        state.lock?.occurrenceId === owner.occurrenceId
          ? {
              ...state,
              blockedReason:
                "Owning Workflow history is unavailable; retain the claim and reconcile remote history",
            }
          : state,
    );
  }
  return await updatePromotionState(
    input.store,
    input.state.targetId,
    (state) => {
      if (state.lock?.occurrenceId !== owner.occurrenceId) return state;
      const uncertain = state.attempts.some(
        (attempt) => attempt.status === "uncertain",
      );
      return {
        ...state,
        lock: uncertain ? state.lock : null,
        blockedReason: uncertain
          ? "Owning Workflow closed with an uncertain submission; reconcile remote history"
          : state.blockedReason,
      };
    },
  );
}
