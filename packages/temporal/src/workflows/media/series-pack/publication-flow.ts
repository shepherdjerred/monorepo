import { patched, proxyActivities } from "@temporalio/workflow";
import type {
  MediaAttemptOperation,
  MediaFileActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";
import { publishSeriesPackMembers } from "./bounded-publication.ts";

const files = proxyActivities<
  Pick<
    MediaFileActivities,
    "prepareSeriesPackPublication" | "promoteMediaFiles"
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

/** Absent new history markers retain the exact original Activity names and options. */
export async function publishAcquisitionFiles(
  input: MediaAttemptOperation,
  seriesPack: boolean,
  boundedSeriesPack: boolean,
) {
  if (boundedSeriesPack && patched("series-pack-bounded-publication-v1")) {
    const result = await publishSeriesPackMembers(input);
    return { ...result, boundedPublication: true };
  }
  if (seriesPack && patched("series-pack-publication-v1")) {
    const prepared = await files.prepareSeriesPackPublication({
      operationId: input.operationId,
      attemptId: input.attemptId,
    });
    if (prepared.status !== "prepared")
      return {
        status: prepared.status,
        boundedPublication: false,
        ...(prepared.reason === undefined ? {} : { reason: prepared.reason }),
      };
  }
  const result = await files.promoteMediaFiles(input);
  return { ...result, boundedPublication: false };
}
