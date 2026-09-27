import { proxyActivities } from "@temporalio/workflow";
import type { LlmBilledCostActivities } from "#activities/agent/llm-billed-cost.ts";
import type { LlmBillingSnapshot } from "#shared/llm-billing.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { reconcileLlmBilledCost } = proxyActivities<LlmBilledCostActivities>({
  taskQueue: TASK_QUEUES.BILLING,
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

export async function runLlmBilledCostReconciliation(): Promise<LlmBillingSnapshot> {
  return await reconcileLlmBilledCost();
}
