import { Context } from "@temporalio/activity";
import {
  PromotionRunInputSchema,
  type PromotionRunInput,
} from "#shared/promotion/model.ts";
import {
  promotionStore,
  readPromotionState,
} from "#activities/promotion/store.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import {
  beginPromotionBatch,
  updatePromotionBatch,
  finishPromotionBatch,
} from "./batches.ts";

export async function trackPromotionExecution<
  T extends { status: string; summary: string },
>(raw: PromotionRunInput, execute: (input: PromotionRunInput) => Promise<T>) {
  const input = PromotionRunInputSchema.parse(raw);
  const execution = Context.current().info.workflowExecution;
  if (execution?.workflowId !== `storm-promotion/${input.targetId}`)
    throw new Error("Promotion Workflow ID must be storm-promotion/<targetId>");
  const store = promotionStore(),
    target = promotionTarget(input.targetId);
  const ownBatch = input.batchId === undefined;
  const id = input.batchId ?? `manual/${execution.runId}/${input.mode}`;
  if (ownBatch)
    await beginPromotionBatch({
      store,
      id,
      targets: [target],
      states: [await readPromotionState(store, target.id)],
      selected: [target.id],
      mode: input.mode,
      scope: "selected",
    });
  await updatePromotionBatch({
    store,
    id,
    targetId: target.id,
    change: {
      status: "running",
      phase: "Executing assignment",
      startedAt: new Date().toISOString(),
      occurrenceId: `${execution.workflowId}/${execution.runId}`,
      effectiveMode: input.mode,
    },
  });
  try {
    const result = await execute({ ...input, batchId: id });
    await updatePromotionBatch({
      store,
      id,
      targetId: target.id,
      change: {
        status: result.status === "deferred" ? "skipped" : "completed",
        phase:
          result.status === "deferred"
            ? deferredPhase(result.summary)
            : result.status,
        summary: result.summary,
        finishedAt: new Date().toISOString(),
      },
    });
    return result;
  } catch (error) {
    await updatePromotionBatch({
      store,
      id,
      targetId: target.id,
      change: {
        status: "failed",
        phase: "failed",
        summary:
          "Execution failed; inspect its durable diagnostic and effect history",
        finishedAt: new Date().toISOString(),
      },
    });
    throw error;
  } finally {
    if (ownBatch) await finishPromotionBatch({ store, id, overlaps: [] });
  }
}

function deferredPhase(summary: string) {
  if (/budget|spend|usage/i.test(summary)) return "budget";
  if (/window|daily action limit/i.test(summary)) return "window";
  return /disabled/i.test(summary) ? "disabled" : "cooldown";
}
