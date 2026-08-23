import { proxyActivities } from "@temporalio/workflow";
import type { FreshRssActivities } from "#activities/freshrss.ts";

const { runFreshRssSync } = proxyActivities<FreshRssActivities>({
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
