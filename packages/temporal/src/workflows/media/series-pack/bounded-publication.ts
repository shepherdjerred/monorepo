import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  proxyActivities,
} from "@temporalio/workflow";
import type {
  MediaAttemptOperation,
  MediaFileActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";

const files = proxyActivities<
  Pick<
    MediaFileActivities,
    | "prepareSeriesPackMembersPublicationV1"
    | "sealSeriesPackPublicationIntentV1"
    | "publishSeriesPackMembersV1"
    | "sealSeriesPackPublicationOutcomeV1"
    | "compensateSeriesPackMembersV1"
    | "sealSeriesPackCompensationV1"
    | "rollbackPublishedSeriesPackV1"
  >
>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  heartbeatTimeout: "1 minute",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: "10 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

/** A cancelled coordinator waits for the actual rollback Activity to settle. */
export function rollbackPublishedSeriesPack(input: MediaAttemptOperation) {
  return files.rollbackPublishedSeriesPackV1({
    operationId: input.operationId,
    attemptId: input.attemptId,
  });
}

/** Every cursor is an actual completed four-member receipt; only IDs/ordinals enter history. */
async function prepareAll(input: MediaAttemptOperation) {
  for (let batchIndex = 0; batchIndex < 25; batchIndex++) {
    const prepared = await files.prepareSeriesPackMembersPublicationV1({
      ...input,
      batchIndex,
    });
    if (prepared.status !== "prepared") return prepared;
    if (prepared.nextBatchIndex === null) break;
    if (prepared.nextBatchIndex !== batchIndex + 1)
      throw ApplicationFailure.nonRetryable(
        "Series pack preparation cursor is not contiguous",
        "SeriesPackProtocolError",
      );
    if (batchIndex === 24)
      throw ApplicationFailure.nonRetryable(
        "Series pack preparation exceeds complete100-entry scope",
        "SeriesPackProtocolError",
      );
  }
  return files.sealSeriesPackPublicationIntentV1(input);
}

async function publishAll(input: MediaAttemptOperation) {
  for (let batchIndex = 0; batchIndex < 25; batchIndex++) {
    const published = await files.publishSeriesPackMembersV1({
      ...input,
      batchIndex,
    });
    if (published.status !== "published") return published;
    if (published.nextBatchIndex === null)
      return files.sealSeriesPackPublicationOutcomeV1(input);
    if (published.nextBatchIndex !== batchIndex + 1)
      throw ApplicationFailure.nonRetryable(
        "Series pack publication cursor is not contiguous",
        "SeriesPackProtocolError",
      );
  }
  throw ApplicationFailure.nonRetryable(
    "Series pack publication exceeds complete100-entry scope",
    "SeriesPackProtocolError",
  );
}

export async function publishSeriesPackMembers(raw: MediaAttemptOperation) {
  const input = { operationId: raw.operationId, attemptId: raw.attemptId };
  const prepared = await prepareAll(input);
  if (prepared.status !== "prepared") return prepared;
  try {
    const published = await publishAll(input);
    if (published.status === "published") return published;
    const compensation = await CancellationScope.nonCancellable(() =>
      compensateSeriesPackPublication(input),
    );
    return compensation.status === "compensated" ? published : compensation;
  } catch (error) {
    await CancellationScope.nonCancellable(() =>
      compensateSeriesPackPublication(input),
    );
    throw error;
  }
}

async function compensateSeriesPackPublication(input: MediaAttemptOperation) {
  for (let batchIndex = 0; batchIndex < 25; batchIndex++) {
    const inverse = await files.compensateSeriesPackMembersV1({
      ...input,
      batchIndex,
    });
    if (inverse.status !== "compensated") return inverse;
    if (inverse.nextBatchIndex === null)
      return files.sealSeriesPackCompensationV1(input);
    if (inverse.nextBatchIndex !== batchIndex + 1)
      throw ApplicationFailure.nonRetryable(
        "Series pack inverse cursor is not contiguous",
        "SeriesPackProtocolError",
      );
  }
  throw ApplicationFailure.nonRetryable(
    "Series pack compensation exceeds complete100-entry scope",
    "SeriesPackProtocolError",
  );
}
