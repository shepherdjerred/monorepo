import { continueAsNew, proxyActivities, sleep } from "@temporalio/workflow";
import type {
  MediaFileActivities,
  MediaNetworkActivities,
  MediaWorkflowResult,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

// Retained pre-observation Workflow implementation for actual SDK history/replay.
// Keep its command sequence and options independent of the new implementation.
const files = proxyActivities<
  Pick<MediaFileActivities, "cleanupSupersededMediaFile">
>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
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
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

export async function cleanupMediaUpgradeWorkflow(input: {
  operationId: string;
  cleanupId: string;
}): Promise<MediaWorkflowResult> {
  for (let pass = 0; pass < 12; pass++) {
    const result = await files.cleanupSupersededMediaFile(input);
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
