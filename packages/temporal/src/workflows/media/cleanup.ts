import {
  ActivityCancellationType,
  continueAsNew,
  patched,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type {
  MediaFileActivities,
  MediaNetworkActivities,
  MediaWorkflowResult,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";

const files = proxyActivities<
  Pick<MediaFileActivities, "cleanupSupersededMediaFile">
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
const network = proxyActivities<
  Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "5 minutes",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});
const observation = proxyActivities<
  Pick<MediaNetworkActivities, "observeMediaUpgradeCleanup">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

type CleanupInput = {
  operationId: string;
  cleanupId: string;
};
async function cleanupPass(
  input: CleanupInput,
): Promise<
  Awaited<ReturnType<MediaFileActivities["cleanupSupersededMediaFile"]>>
> {
  const activityInput = patched("media-upgrade-cleanup-input-v2")
    ? { operationId: input.operationId, cleanupId: input.cleanupId }
    : input;
  if (patched("media-upgrade-cleanup-network-observation-v1")) {
    const proof = await observation.observeMediaUpgradeCleanup(activityInput);
    return proof.status === "protected"
      ? { status: "protected", reason: proof.reason }
      : await files.cleanupSupersededMediaFile(activityInput);
  }
  return files.cleanupSupersededMediaFile(activityInput);
}
export async function cleanupMediaUpgradeWorkflow(
  input: CleanupInput,
): Promise<MediaWorkflowResult> {
  for (let pass = 0; pass < 12; pass++) {
    const result = await cleanupPass(input);
    const terminal = result.status !== "protected";
    await network.finishMediaOperation({
      operationId: input.operationId,
      status: terminal ? "completed" : "reconciling",
      reason: result.reason ?? (terminal ? null : "upgrade_cleanup_protected"),
    });
    if (terminal)
      return { status: result.status === "purged" ? "completed" : "obsolete" };
    await sleep("6 hours");
  }
  return continueAsNew<typeof cleanupMediaUpgradeWorkflow>(input);
}
