import { proxyActivities } from "@temporalio/workflow";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { completeActivityQueueReplayProbe } = proxyActivities<{
  completeActivityQueueReplayProbe: () => Promise<string>;
}>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "10 seconds",
});

export async function activityQueueReplayProbe(): Promise<string> {
  return completeActivityQueueReplayProbe();
}
