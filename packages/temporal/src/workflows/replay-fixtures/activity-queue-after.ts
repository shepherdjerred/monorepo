import { proxyActivities } from "@temporalio/workflow";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { REPORT_DELIVERY_ACTIVITY_RETRY } from "#shared/reports/report-delivery-policy.ts";

const { completeActivityQueueReplayProbe } = proxyActivities<{
  completeActivityQueueReplayProbe: () => Promise<string>;
}>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "10 seconds",
  retry: REPORT_DELIVERY_ACTIVITY_RETRY,
});

export async function activityQueueReplayProbe(): Promise<string> {
  return completeActivityQueueReplayProbe();
}
