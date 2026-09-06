import { patched, proxyActivities } from "@temporalio/workflow";
import type {
  ScoutBryanBucksActivities,
  ScoutBryanBucksAnalyticsResult,
} from "#activities/scout/scout-bryan-bucks.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { syncScoutBryanBucksAnalytics } =
  proxyActivities<ScoutBryanBucksActivities>({
    taskQueue: TASK_QUEUES.SCOUT,
    startToCloseTimeout: "2 minutes",
    retry: {
      maximumAttempts: 5,
      initialInterval: "10 seconds",
      backoffCoefficient: 2,
      maximumInterval: "1 minute",
    },
  });

const { syncScoutBryanBucksAnalytics: syncEmbeddedScoutBryanBucksAnalytics } =
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
  if (patched("scout-bryan-bucks-embedded-activity-v1")) {
    return await syncEmbeddedScoutBryanBucksAnalytics();
  }
  return await syncScoutBryanBucksAnalytics();
}
