import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type {
  ObservePlexHintInput,
  PlexEventActivities,
} from "@shepherdjerred/media/plex-events";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  PlexEventActivities & Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

export async function observePlexEventHintWorkflow(
  input: ObservePlexHintInput,
) {
  const result = await network.observePlexEventHint(input);
  await network.finishMediaOperation({
    operationId: input.operationId,
    status: "completed",
    reason: result.status === "observed" ? null : result.status,
  });
  return result;
}
