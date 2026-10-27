import {
  ActivityCancellationType,
  continueAsNew,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type Input = Parameters<MediaNetworkActivities["matchProviderFeedSource"]>[0];
const network = proxyActivities<
  Pick<
    MediaNetworkActivities,
    "matchProviderFeedSource" | "finishMediaOperation"
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

/** New source-only history; raw provider data and private URLs remain in Activities. */
export async function matchProviderFeedSourceWorkflow(
  input: Input,
): Promise<void> {
  const operation = {
    schemaVersion: input.schemaVersion,
    operationId: input.operationId,
    sourceId: input.sourceId,
  };
  let cursor = input.cursor;
  for (let page = 0; page < 20; page++) {
    const result = await network.matchProviderFeedSource({
      ...operation,
      cursor,
    });
    cursor = result.nextCursor;
    if (result.status === "paused") {
      await sleep("15 minutes");
    } else if (cursor === null) {
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: "completed",
        reason: null,
      });
      return;
    }
  }
  return continueAsNew<typeof matchProviderFeedSourceWorkflow>({
    ...operation,
    cursor,
  });
}
