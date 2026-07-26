import { proxyActivities } from "@temporalio/workflow";
import type {
  ScoutQueueWindowsActivities,
  ScoutQueueWindowsResult,
} from "#activities/scout-queue-windows.ts";

const { refreshScoutQueueWindows } =
  proxyActivities<ScoutQueueWindowsActivities>({
    // Clones the monorepo, does the root + scout workspace installs, scans
    // the scout-prod match lake for the 21-day lookback, and opens a PR on
    // window drift (auto-merge for open/reopen edits only). Heartbeats fire
    // every 10s in the activity, so worker death surfaces in <60s. 30 min
    // leaves room for a retry inside the 45-min workflowExecutionTimeout.
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "2 minutes",
      backoffCoefficient: 2,
      maximumInterval: "10 minutes",
    },
  });

export async function runScoutQueueWindowsWatch(): Promise<ScoutQueueWindowsResult> {
  return await refreshScoutQueueWindows();
}
