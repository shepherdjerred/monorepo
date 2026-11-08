import { ApplicationFailure, proxyActivities } from "@temporalio/workflow";
import type {
  MediaAttemptOperation,
  MediaFileActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";

const files = proxyActivities<
  Pick<
    MediaFileActivities,
    "stageSeriesPackMembersV1" | "sealSeriesPackStagingV1"
  >
>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  heartbeatTimeout: "1 minute",
  retry: {
    initialInterval: "10 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

/** History carries IDs and the bounded batch ordinal; native member metadata stays in PostgreSQL. */
export async function stageSeriesPackMembers(raw: MediaAttemptOperation) {
  const input = { operationId: raw.operationId, attemptId: raw.attemptId };
  let batchIndex = 0;
  for (let count = 0; count < 25; count++) {
    const batch = await files.stageSeriesPackMembersV1({
      ...input,
      batchIndex,
    });
    if (batch.status !== "staged") return batch;
    if (batch.nextBatchIndex === null)
      return files.sealSeriesPackStagingV1(input);
    if (batch.nextBatchIndex !== batchIndex + 1)
      throw ApplicationFailure.nonRetryable(
        "Series pack staging returned a noncontiguous batch ordinal",
        "SeriesPackProtocolError",
      );
    batchIndex = batch.nextBatchIndex;
  }
  throw ApplicationFailure.nonRetryable(
    "Series pack staging exceeded its complete100-member scope",
    "SeriesPackProtocolError",
  );
}
