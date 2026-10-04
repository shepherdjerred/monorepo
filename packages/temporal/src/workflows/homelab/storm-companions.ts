import { proxyActivities } from "@temporalio/workflow";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { StormCompanionActivities } from "#activities/homelab/storm-companions.ts";

const activities = proxyActivities<StormCompanionActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "30 seconds",
  scheduleToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3, initialInterval: "5 seconds" },
});
export async function reconcileStormCompanionsWorkflow(): Promise<void> {
  await activities.reconcileStormCompanions();
}
