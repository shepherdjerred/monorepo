import { proxyActivities } from "@temporalio/workflow";
import type { PromotionActivities } from "#activities/promotion/index.ts";
import type { PromotionAbsenceResolution } from "@shepherdjerred/ops-model/promotion/absence-resolution.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const control = proxyActivities<
  Pick<PromotionActivities, "resolvePromotionAbsence">
>({
  taskQueue: TASK_QUEUES.PROMOTION_CONTROL,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

/** A separate operator decision; existing publishing histories are unchanged. */
export async function resolveStormPromotionAbsence(
  input: PromotionAbsenceResolution,
) {
  return await control.resolvePromotionAbsence(input);
}
