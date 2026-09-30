import { patched, proxyActivities } from "@temporalio/workflow";

type Result = { status: "reconciled"; detail: string };
type Activities = {
  syncScoutBryanBucksAnalytics: () => Promise<Result>;
};

const { syncScoutBryanBucksAnalytics } = proxyActivities<Activities>({
  taskQueue: "scout",
  startToCloseTimeout: "2 minutes",
});

const { syncScoutBryanBucksAnalytics: syncEmbeddedScoutBryanBucksAnalytics } =
  proxyActivities<Activities>({
    taskQueue: "scout-beta-background",
    startToCloseTimeout: "2 minutes",
    heartbeatTimeout: "30 seconds",
  });

export async function runScoutBryanBucksAnalyticsWorkflow(): Promise<Result> {
  return patched("scout-bryan-bucks-embedded-activity-v1")
    ? await syncEmbeddedScoutBryanBucksAnalytics()
    : await syncScoutBryanBucksAnalytics();
}
