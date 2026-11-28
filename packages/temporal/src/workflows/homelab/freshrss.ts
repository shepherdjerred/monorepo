import { patched, proxyActivities } from "@temporalio/workflow";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { runFreshRssSync } = proxyActivities<{
  runFreshRssSync: () => Promise<unknown>;
}>({
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

/** New starts are no-ops. Retained histories still have the original Activity command. */
export async function runFreshRssSyncWorkflow(): Promise<void> {
  if (!patched("retire-freshrss-sync-hourly-v1")) await runFreshRssSync();
}
