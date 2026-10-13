import { log, proxyActivities } from "@temporalio/workflow";
import type { TrackerAttachmentActivities } from "#activities/maintenance/tracker-attachments.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { cleanupTrackerAttachments } =
  proxyActivities<TrackerAttachmentActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    startToCloseTimeout: "1 minute",
    retry: {
      // A lost HTTP response is ambiguous: retrying could delete another
      // 100-row batch. The next hourly Schedule safely retries the cleanup.
      maximumAttempts: 1,
      initialInterval: "30 seconds",
      maximumInterval: "1 minute",
    },
  });

export async function runTrackerAttachmentCleanup() {
  const result = await cleanupTrackerAttachments();
  log.info("Tracker staged attachment cleanup", result);
  return result;
}
