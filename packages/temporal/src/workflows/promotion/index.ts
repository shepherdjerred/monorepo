import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import {
  ParentClosePolicy,
  proxyActivities,
  startChild,
} from "@temporalio/workflow";
import type { PromotionActivities } from "#activities/promotion/index.ts";
import type { ReportDeliveryActivities } from "#activities/reports/report-delivery.ts";
import type { PromotionRunInput } from "#shared/promotion.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  REPORT_DELIVERY_ACTIVITY_RETRY,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
} from "#shared/reports/report-delivery-policy.ts";

const reads = proxyActivities<
  Pick<
    PromotionActivities,
    | "inspectPromotionTick"
    | "managePromotion"
    | "acknowledgePromotionAlert"
    | "collectPromotionDailyReport"
  >
>({
  taskQueue: TASK_QUEUES.PROMOTION_CONTROL,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});
const writes = proxyActivities<Pick<PromotionActivities, "executePromotion">>({
  taskQueue: TASK_QUEUES.PROMOTION,
  startToCloseTimeout: "17 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});
const reports = proxyActivities<
  Pick<ReportDeliveryActivities, "deliverReport">
>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
  retry: REPORT_DELIVERY_ACTIVITY_RETRY,
});

export async function runStormPromotion(input: PromotionRunInput) {
  return await writes.executePromotion(input);
}

export async function dispatchStormPromotion() {
  const tick = await reads.inspectPromotionTick();
  for (const targetId of tick.dueTargetIds) {
    try {
      await startChild(runStormPromotion, {
        workflowId: `storm-promotion/${targetId}`,
        args: [{ targetId, mode: "run" }],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      });
    } catch (error: unknown) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
  for (const alert of tick.alerts) {
    await reports.deliverReport(alert.report);
    await reads.acknowledgePromotionAlert(alert.targetId, alert.fingerprint);
  }
  return { dispatched: tick.dueTargetIds.length, alerts: tick.alerts.length };
}

export async function manageStormPromotion(
  input: Parameters<PromotionActivities["managePromotion"]>[0],
) {
  return await reads.managePromotion(input);
}

export async function reportStormPromotion() {
  return await reports.deliverReport(await reads.collectPromotionDailyReport());
}
