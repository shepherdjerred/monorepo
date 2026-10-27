import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import type {
  LibraryPlexBindingActivities,
  LibraryPlexBindingInputV1,
} from "@shepherdjerred/media/plex-binding";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  LibraryPlexBindingActivities &
    Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

/** Additive Workflow; existing handoff and Plex binding histories keep their recorded contracts. */
export async function verifyLibraryPlexBindingWorkflow(
  input: LibraryPlexBindingInputV1,
) {
  const result = await network.verifyLibraryPlexBinding(input);
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
