import { proxyActivities } from "@temporalio/workflow";
import type { PromotionAiAllocationRequest } from "@shepherdjerred/ops-model/promotion/ai-allocation.ts";
import type { allocatePromotionAi } from "#activities/promotion/control/ai-allocation.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const control = proxyActivities<{
  allocatePromotionAi: typeof allocatePromotionAi;
}>({
  taskQueue: TASK_QUEUES.PROMOTION_CONTROL,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

export async function allocateStormPromotionAi(
  input: PromotionAiAllocationRequest,
) {
  return await control.allocatePromotionAi(input);
}
