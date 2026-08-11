import { proxyActivities } from "@temporalio/workflow";
import type {
  ReportDeliveryActivities,
  ReportDeliveryResult,
} from "#activities/report-delivery.ts";
import type { ReportEnvelopeV1 } from "#shared/report.ts";
import {
  REPORT_DELIVERY_ACTIVITY_RETRY,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
} from "#shared/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const reportDeliveryActivities = proxyActivities<
  Pick<ReportDeliveryActivities, "deliverReport">
>({
  taskQueue: TASK_QUEUES.DEFAULT,
  startToCloseTimeout: REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
  retry: REPORT_DELIVERY_ACTIVITY_RETRY,
});

/**
 * Fixed credential boundary for reports assembled outside the core queue.
 *
 * Replayed agent-task histories must schedule their original email activity on
 * the agent queue for Temporal determinism. That activity delegates here so
 * Postal and report-state S3 credentials remain confined to the core worker.
 */
export async function deliverReportWorkflow(
  report: ReportEnvelopeV1,
): Promise<ReportDeliveryResult> {
  return reportDeliveryActivities.deliverReport(report);
}
