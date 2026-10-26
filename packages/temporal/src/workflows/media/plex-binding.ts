import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type {
  PlexBindingActivities,
  ReverifyPlexBindingInput,
} from "@shepherdjerred/media/plex-binding";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  PlexBindingActivities & Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

export async function reverifyPlexBindingWorkflow(
  input: ReverifyPlexBindingInput,
) {
  const result = await network.reverifyPlexBinding(input);
  await network.finishMediaOperation({
    operationId: input.operationId,
    status: "completed",
    reason:
      result.status === "verified"
        ? null
        : result.status === "superseded"
          ? "superseded"
          : result.reason,
  });
  return result;
}
