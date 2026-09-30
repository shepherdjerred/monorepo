import { proxyActivities } from "@temporalio/workflow";
import type { FreshRssActivities } from "#activities/maintenance/freshrss.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { runFreshRssSync } = proxyActivities<FreshRssActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "4 minutes",
  scheduleToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

export async function runFreshRssSyncWorkflow(): Promise<void> {
  await runFreshRssSync();
}
