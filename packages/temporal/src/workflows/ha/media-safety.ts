import { proxyActivities } from "@temporalio/workflow";
import type { MediaSafetyActivities } from "#activities/home/media-safety.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { inspectMediaDownloadSafety } = proxyActivities<MediaSafetyActivities>({
  taskQueue: TASK_QUEUES.HOME,
  startToCloseTimeout: "2 minutes",
  // A response may be lost after a write. The next scan reads the app's durable
  // history and blocklist before deciding whether any effect remains necessary.
  retry: { maximumAttempts: 1 },
});

export async function runMediaDownloadSafety() {
  return inspectMediaDownloadSafety();
}
