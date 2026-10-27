import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  isCancellation,
  proxyActivities,
} from "@temporalio/workflow";
import type {
  LibraryHandoffFileActivities,
  LibraryHandoffNetworkActivities,
  MediaHandoffFileActivities,
  MediaHandoffNetworkActivities,
  MediaHandoffOperation,
  MediaNetworkActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";

const network = proxyActivities<
  LibraryHandoffNetworkActivities &
    MediaHandoffNetworkActivities &
    Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});
const files = proxyActivities<
  LibraryHandoffFileActivities & MediaHandoffFileActivities
>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  heartbeatTimeout: "1 minute",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});

/** New effectful protocol has its own Workflow type; retained read-only handoff histories stay literal. */
export async function applyLibraryHandoffV3Workflow(
  input: MediaHandoffOperation,
): Promise<void> {
  const scope = new CancellationScope();
  let work: Promise<void> | undefined;
  try {
    await scope.run(async () => {
      await network.observeMediaHandoff(input);
      const planned = await network.plannedLibraryPlexEdits(input);
      const state = { done: false };
      work = (async () => {
        try {
          for (const assetId of planned.assetIds) {
            const edit = { ...input, schemaVersion: 3 as const, assetId };
            const filesObservation =
              await files.prepareLibraryPlexEditFile(edit);
            await network.editLibraryPlexEdition({ ...edit, filesObservation });
          }
          await network.observeMediaHandoff(input);
          await files.applyMediaHandoffFiles(input);
        } finally {
          state.done = true;
        }
      })();
      await Promise.all([work, refresh(input, () => state.done)]);
    });
    await network.finishMediaOperation({
      operationId: input.operationId,
      status: "completed",
      reason: null,
    });
  } catch (error) {
    scope.cancel();
    const completed = await CancellationScope.nonCancellable(async () => {
      if (work !== undefined) await Promise.allSettled([work]);
      const state = await network.mediaHandoffState(input);
      if (!state.applied) await network.protectLibraryHandoff(input);
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: state.applied ? "completed" : "reconciling",
        reason: state.applied
          ? null
          : isCancellation(error)
            ? "library_handoff_cancelled_requires_review"
            : "library_handoff_evidence_requires_review",
      });
      return state.applied;
    });
    if (!completed) throw error;
  }
}

async function refresh(input: MediaHandoffOperation, done: () => boolean) {
  while (!done()) {
    if (await condition(done, "30 seconds")) return;
    try {
      await network.observeMediaHandoff(input);
    } catch (error) {
      if (!done()) throw error;
    }
  }
}
