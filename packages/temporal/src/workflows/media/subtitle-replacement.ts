import {
  ActivityCancellationType,
  CancellationScope,
  proxyActivities,
  sleep,
  isCancellation,
} from "@temporalio/workflow";
import type {
  SubtitleReplacementFileActivities,
  SubtitleReplacementNetworkActivities,
  SubtitleReplacementInput,
  SubtitleReplacementResult,
} from "@shepherdjerred/media/subtitle-replacement";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const files = proxyActivities<SubtitleReplacementFileActivities>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  heartbeatTimeout: "1 minute",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});
const network = proxyActivities<
  SubtitleReplacementNetworkActivities &
    Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 3, initialInterval: "5 seconds" },
});

async function finish(
  input: SubtitleReplacementInput,
  result: SubtitleReplacementResult,
) {
  const state = await network.subtitleReplacementState(input);
  if (state.receiptOutcome !== null && !state.reservationActive)
    await network.queueSubtitleReplacementCleanup(input);
  await network.finishMediaOperation({
    operationId: input.operationId,
    status: result.state === "protected" ? "reconciling" : "completed",
    reason: result.reason ?? null,
  });
}
async function replace(
  input: SubtitleReplacementInput,
  phase: "prepare" | "apply" | "reconcile",
) {
  try {
    const result =
      phase === "prepare"
        ? await files.prepareSubtitleReplacement(input)
        : phase === "apply"
          ? await files.applySubtitleReplacement(input)
          : await files.reconcileSubtitleReplacement(input);
    await finish(input, result);
  } catch (error) {
    const settled = await CancellationScope.nonCancellable(async () => {
      try {
        // WAIT_CANCELLATION_COMPLETED fences the original executor before compensation.
        if (!(await network.beginSubtitleReplacementReconciliation(input)))
          throw new Error("Subtitle replacement coordinator changed");
        const result = await files.reconcileSubtitleReplacement(input);
        await finish(input, result);
        return result.state === "applied" || result.state === "rolled_back";
      } catch {
        await network.finishMediaOperation({
          operationId: input.operationId,
          status: "reconciling",
          reason: isCancellation(error)
            ? "subtitle_replacement_cancelled_requires_review"
            : "subtitle_replacement_outcome_requires_review",
        });
        return false;
      }
    });
    if (!settled) throw error;
  }
}
export async function prepare(input: SubtitleReplacementInput) {
  await replace(input, "prepare");
}
export async function apply(input: SubtitleReplacementInput) {
  await replace(input, "apply");
}
export async function reconcile(input: SubtitleReplacementInput) {
  await replace(input, "reconcile");
}
export async function cleanup(input: SubtitleReplacementInput) {
  const state = await network.subtitleReplacementState(input);
  if (state.cleanupState === "cleaned") {
    await network.finishMediaOperation({
      operationId: input.operationId,
      status: "completed",
      reason: null,
    });
    return;
  }
  if (
    state.archiveExpiresAt === null ||
    state.receiptOutcome === null ||
    state.reservationActive
  ) {
    await network.finishMediaOperation({
      operationId: input.operationId,
      status: "reconciling",
      reason: "subtitle_cleanup_receipt_required",
    });
    return;
  }
  const delay = Date.parse(state.archiveExpiresAt) - Date.now();
  if (delay > 0) await sleep(delay);
  const result = await files.cleanupSubtitleReplacement(input);
  if (result.state === "waiting" && result.retryAt !== undefined) {
    const retryDelay = Date.parse(result.retryAt) - Date.now();
    if (retryDelay > 0) await sleep(retryDelay);
    const retried = await files.cleanupSubtitleReplacement(input);
    await network.finishMediaOperation({
      operationId: input.operationId,
      status: retried.state === "cleaned" ? "completed" : "reconciling",
      reason: retried.reason ?? null,
    });
    return;
  }
  await network.finishMediaOperation({
    operationId: input.operationId,
    status: result.state === "cleaned" ? "completed" : "reconciling",
    reason: result.reason ?? null,
  });
}
