import { proxyActivities } from "@temporalio/workflow";
import type { GitBackupActivities } from "#activities/repo/git-backup.ts";
import {
  buildGitBackupFailureReport,
  buildGitBackupReport,
  type GitBackupResult,
} from "#activities/repo/git-backup-report.ts";
import type { ReportDeliveryActivities } from "#activities/reports/report-delivery.ts";
import {
  REPORT_DELIVERY_ACTIVITY_RETRY,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
} from "#shared/reports/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { reportActivityTaskQueue } from "#workflows/scout/report-activity-queue.ts";
import { rethrowReportDeliveryFailure } from "#workflows/scout/report-delivery.ts";

const { runGitBackup } = proxyActivities<GitBackupActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "3 hours",
  heartbeatTimeout: "2 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "2 minutes",
    backoffCoefficient: 2,
    maximumInterval: "10 minutes",
  },
});

export async function runGitBackupWorkflow(
  reportTaskQueue?: string,
): Promise<GitBackupResult> {
  const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
    taskQueue: reportActivityTaskQueue(reportTaskQueue),
    startToCloseTimeout: REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
    retry: REPORT_DELIVERY_ACTIVITY_RETRY,
  });

  const startedAt = new Date().toISOString();
  let result: GitBackupResult;
  try {
    result = await runGitBackup();
  } catch (error: unknown) {
    rethrowReportDeliveryFailure(error);
    await deliverActivityReport(buildGitBackupFailureReport(startedAt, error));
    throw error;
  }

  await deliverActivityReport(buildGitBackupReport(result));
  return result;
}
