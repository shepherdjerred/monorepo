import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  proxyActivities,
  isCancellation,
} from "@temporalio/workflow";
import type {
  MediaHandoffFileActivities,
  MediaHandoffNetworkActivities,
  MediaHandoffOperation,
  MediaNetworkActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  MediaHandoffNetworkActivities &
    Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});
const files = proxyActivities<MediaHandoffFileActivities>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  heartbeatTimeout: "1 minute",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});

async function runHandoff(
  input: MediaHandoffOperation,
  apply: boolean,
): Promise<void> {
  const scope = new CancellationScope();
  let fileWork: Promise<void> | undefined;
  try {
    await scope.run(async () => {
      await network.observeMediaHandoff(input);
      const state = { done: false };
      const executeFiles = async () => {
        try {
          if (apply) await files.applyMediaHandoffFiles(input);
          else await files.prepareMediaHandoffFiles(input);
        } finally {
          state.done = true;
        }
      };
      fileWork = executeFiles();
      await Promise.all([
        fileWork,
        refreshUntilComplete(input, () => state.done),
      ]);
    });
    await network.finishMediaOperation({
      operationId: input.operationId,
      status: "completed",
      reason: null,
    });
  } catch (error) {
    scope.cancel();
    const completed = await CancellationScope.nonCancellable(async () => {
      if (fileWork !== undefined) await Promise.allSettled([fileWork]);
      const state = await network.mediaHandoffState(input);
      const complete =
        state.applied || (!apply && state.state === "awaiting_review");
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: complete ? "completed" : "reconciling",
        reason: complete
          ? null
          : isCancellation(error)
            ? "handoff_cancelled_requires_review"
            : "handoff_evidence_requires_review",
      });
      return complete;
    });
    if (completed) return;
    throw error;
  }
}

async function refreshUntilComplete(
  input: MediaHandoffOperation,
  isDone: () => boolean,
): Promise<void> {
  while (!isDone()) {
    if (await condition(isDone, "30 seconds")) return;
    try {
      await network.observeMediaHandoff(input);
    } catch (error) {
      if (!isDone()) throw error;
    }
  }
}

export async function prepareMediaHandoffWorkflow(
  input: MediaHandoffOperation,
): Promise<void> {
  await runHandoff(input, false);
}
export async function applyMediaHandoffWorkflow(
  input: MediaHandoffOperation,
): Promise<void> {
  await runHandoff(input, true);
}
