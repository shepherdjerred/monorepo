import {
  ActivityCancellationType,
  CancellationScope,
  ContinueAsNew,
  isCancellation,
  proxyActivities,
} from "@temporalio/workflow";
import type {
  MediaNetworkActivities,
  MediaWorkflowResult,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

export async function finishMovieOperationV4(
  operationId: string,
  result: MediaWorkflowResult,
) {
  await network.finishMediaOperation({
    operationId,
    status: result.status === "blocked" ? "reconciling" : "completed",
    reason: result.reason ?? null,
  });
  return result;
}

export async function recoverableMovieOperationV4(
  operationId: string,
  work: () => Promise<MediaWorkflowResult>,
) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ContinueAsNew) throw error;
    await CancellationScope.nonCancellable(() =>
      network.finishMediaOperation({
        operationId,
        status: "reconciling",
        reason: isCancellation(error)
          ? "movie_operation_cancelled"
          : "movie_operation_failed",
      }),
    );
    throw error;
  }
}
