import { proxyActivities } from "@temporalio/workflow";
import type { PromotionActivities } from "#activities/promotion/index.ts";
import type { ReportDeliveryActivities } from "#activities/reports/report-delivery.ts";
import {
  REPORT_DELIVERY_ACTIVITY_RETRY,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
} from "#shared/reports/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const reads = proxyActivities<
  Pick<PromotionActivities, "collectPromotionDailyReport">
>({
  taskQueue: TASK_QUEUES.PROMOTION_CONTROL,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

const reports = proxyActivities<
  Pick<ReportDeliveryActivities, "deliverReport">
>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
  retry: REPORT_DELIVERY_ACTIVITY_RETRY,
});

export async function reportStormPromotion() {
  return await reports.deliverReport(await reads.collectPromotionDailyReport());
}
