import { proxyActivities } from "@temporalio/workflow";
import type { ReportFreshnessActivities } from "#activities/report-freshness.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { inspectReportFreshness } = proxyActivities<ReportFreshnessActivities>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3 },
});

export async function monitorReportFreshness(): Promise<void> {
  await inspectReportFreshness();
}
