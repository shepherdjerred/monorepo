import { proxyActivities } from "@temporalio/workflow";
import type { BugsinkHousekeepingActivities } from "#activities/bugsink.ts";

const { runBugsinkHousekeeping } =
  proxyActivities<BugsinkHousekeepingActivities>({
    startToCloseTimeout: "30 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "30s",
      backoffCoefficient: 2,
      maximumInterval: "5 minutes",
    },
  });

export async function runBugsinkHousekeepingWorkflow(): Promise<void> {
  const result = await runBugsinkHousekeeping();
  console.warn("Bugsink housekeeping complete:\n", result);
}
