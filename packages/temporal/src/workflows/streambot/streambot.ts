import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "#activities/streambot.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
const streambot = proxyActivities<typeof activities>({
  taskQueue: TASK_QUEUES.STREAMBOT,
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "90 seconds",
  // A lost HTTP response is reconciled from durable ownership on the next tick.
  retry: { maximumAttempts: 1 },
});
export async function reconcileStreambotPlaybackWorkflow(): Promise<void> {
  await streambot.reconcileStreambotPlayback();
}
