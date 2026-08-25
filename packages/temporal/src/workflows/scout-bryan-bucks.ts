import { proxyActivities } from "@temporalio/workflow";
import type {
  ScoutBryanBucksActivities,
  ScoutBryanBucksAnalyticsResult,
} from "#activities/scout-bryan-bucks.ts";

const { syncScoutBryanBucksAnalytics } =
  proxyActivities<ScoutBryanBucksActivities>({
    taskQueue: "scout-beta-background",
    startToCloseTimeout: "2 minutes",
    heartbeatTimeout: "30 seconds",
    retry: {
      maximumAttempts: 5,
      initialInterval: "10 seconds",
      backoffCoefficient: 2,
      maximumInterval: "1 minute",
    },
  });

export async function runScoutBryanBucksAnalyticsWorkflow(): Promise<ScoutBryanBucksAnalyticsResult> {
  return await syncScoutBryanBucksAnalytics();
}
