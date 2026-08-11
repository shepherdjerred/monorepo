import { proxyActivities } from "@temporalio/workflow";
import type { ReportFreshnessActivities } from "#activities/report-freshness.ts";

const { inspectReportFreshness } = proxyActivities<ReportFreshnessActivities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3 },
});

export async function monitorReportFreshness(): Promise<void> {
  await inspectReportFreshness();
}
