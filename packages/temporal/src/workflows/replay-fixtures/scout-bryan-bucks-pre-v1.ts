import { proxyActivities } from "@temporalio/workflow";

const { syncScoutBryanBucksAnalytics } = proxyActivities<{
  syncScoutBryanBucksAnalytics: () => Promise<{
    status: "reconciled";
    detail: string;
  }>;
}>({
  taskQueue: "scout",
  startToCloseTimeout: "2 minutes",
});

export async function runScoutBryanBucksAnalyticsWorkflow(): Promise<{
  status: "reconciled";
  detail: string;
}> {
  return await syncScoutBryanBucksAnalytics();
}
