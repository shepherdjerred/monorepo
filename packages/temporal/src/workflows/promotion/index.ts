import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import {
  ParentClosePolicy,
  proxyActivities,
  startChild,
  sleep,
  patched,
  workflowInfo,
} from "@temporalio/workflow";
import type { PromotionActivities } from "#activities/promotion/index.ts";
import * as absenceResolution from "./absence-resolution.ts";
import * as aiAllocation from "./ai-allocation.ts";
import type { ReportDeliveryActivities } from "#activities/reports/report-delivery.ts";
import type { PromotionRunInput } from "#shared/promotion/model.ts";
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
    | "finishPromotionBatch"
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
  if (input.notBefore !== undefined && Date.parse(input.notBefore) > Date.now())
    await sleep(Date.parse(input.notBefore) - Date.now());
  return await writes.executePromotion(input);
}

export async function dispatchStormPromotion() {
  const scheduled = patched("promotion-core-hours-v1");
  const tick = scheduled
    ? await reads.inspectPromotionTick(true)
    : await reads.inspectPromotionTick();
  const completions: Promise<unknown>[] = [];
  const overlaps: string[] = [];
  const selected = scheduled
    ? [...tick.dueTargetIds, ...tick.reconcileTargetIds]
    : tick.dueTargetIds;
  for (const targetId of selected) {
    const child = await startSource(
      targetId,
      assignment(targetId, tick, scheduled),
    );
    if (child === null) overlaps.push(targetId);
    else if (scheduled) completions.push(settleChild(child));
  }
  if (scheduled && tick.batchId !== null) {
    await Promise.all(completions);
    await reads.finishPromotionBatch({ id: tick.batchId, overlaps });
  }
  for (const alert of tick.alerts) {
    await reports.deliverReport(alert.report);
    await reads.acknowledgePromotionAlert(alert.targetId, alert.fingerprint);
  }
  return { dispatched: tick.dueTargetIds.length, alerts: tick.alerts.length };
}

type Tick = Awaited<ReturnType<PromotionActivities["inspectPromotionTick"]>>;
function assignment(
  targetId: string,
  tick: Tick,
  scheduled: boolean,
): PromotionRunInput {
  if (!scheduled) return { targetId, mode: "run" };
  const reconcile = tick.reconcileTargetIds.includes(targetId);
  return {
    targetId,
    mode: reconcile ? "reconcile" : "run",
    scheduled: true,
    ...(reconcile ? {} : { notBefore: tick.notBefore[targetId] }),
    ...(tick.batchId === null ? {} : { batchId: tick.batchId }),
  };
}
async function startSource(targetId: string, input: PromotionRunInput) {
  try {
    return await startChild(runStormPromotion, {
      workflowId: `storm-promotion/${targetId}`,
      args: [input],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    return null;
  }
}
async function settleChild(
  child: NonNullable<Awaited<ReturnType<typeof startSource>>>,
) {
  try {
    return await child.result();
  } catch {
    return null;
  }
}

export async function manageStormPromotion(
  input: Parameters<PromotionActivities["managePromotion"]>[0],
) {
  return await reads.managePromotion(input);
}

export const resolveStormPromotionAbsence =
  absenceResolution.resolveStormPromotionAbsence;
export const allocateStormPromotionAi = aiAllocation.allocateStormPromotionAi;

export async function reportStormPromotion() {
  return await reports.deliverReport(await reads.collectPromotionDailyReport());
}

export async function reportStormPromotionAcceptance() {
  const report = await reads.collectPromotionDailyReport();
  return await reports.deliverReport({
    ...report,
    reportRunId: `storm-promotion/acceptance/${workflowInfo().runId}`,
  });
}
