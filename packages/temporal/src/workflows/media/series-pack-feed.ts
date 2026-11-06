import {
  ActivityCancellationType,
  continueAsNew,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type Input = Parameters<MediaNetworkActivities["matchSeriesPackFeedSource"]>[0];
const network = proxyActivities<
  Pick<
    MediaNetworkActivities,
    "matchSeriesPackFeedSource" | "finishMediaOperation"
  >
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

/** Only source/command/cursor IDs cross history; the original generic feed Workflow stays literal. */
export async function matchSeriesPackFeedSourceWorkflow(
  input: Input,
): Promise<void> {
  const operation = {
    schemaVersion: input.schemaVersion,
    operationId: input.operationId,
    sourceId: input.sourceId,
  };
  let cursor =
    input.cursor === null
      ? null
      : { mediaId: input.cursor.mediaId, edition: input.cursor.edition };
  for (let page = 0; page < 20; page++) {
    const result = await network.matchSeriesPackFeedSource({
      ...operation,
      cursor,
    });
    cursor =
      result.nextCursor === null
        ? null
        : {
            mediaId: result.nextCursor.mediaId,
            edition: result.nextCursor.edition,
          };
    if (result.status === "paused") await sleep("15 minutes");
    else if (cursor === null) {
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: "completed",
        reason: null,
      });
      return;
    }
  }
  return continueAsNew<typeof matchSeriesPackFeedSourceWorkflow>({
    ...operation,
    cursor,
  });
}
