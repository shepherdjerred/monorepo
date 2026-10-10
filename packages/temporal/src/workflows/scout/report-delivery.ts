import { ActivityFailure } from "@temporalio/common";
import { patched, proxyActivities } from "@temporalio/workflow";
import type {
  ReportDeliveryActivities,
  ReportDeliveryResult,
} from "#activities/reports/report-delivery.ts";
import type { ReportEnvelopeV1 } from "#shared/reports/report.ts";
import {
  REPORT_DELIVERY_ACTIVITY_RETRY,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
} from "#shared/reports/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const reportDeliveryActivities = proxyActivities<
  Pick<ReportDeliveryActivities, "deliverReport">
>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
  retry: REPORT_DELIVERY_ACTIVITY_RETRY,
});

/**
 * Fixed credential boundary for reports assembled on any workflow queue.
 *
 * Postal and report-state S3 credentials remain confined to the reports worker.
 */
export async function deliverReportWorkflow(
  report: ReportEnvelopeV1,
): Promise<ReportDeliveryResult> {
  return reportDeliveryActivities.deliverReport(report);
}

/** Keep a delivery outage from becoming a second, false collection report. */
export function rethrowReportDeliveryFailure(error: unknown): void {
  if (
    error instanceof ActivityFailure &&
    error.activityType === "deliverActivityReport" &&
    patched("report-delivery-error-is-not-collection-failure-v1")
  ) {
    throw error;
  }
}
