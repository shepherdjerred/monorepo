import { proxyActivities } from "@temporalio/workflow";
import type { OpenAiComplimentaryUsageActivities } from "#activities/agent/openai-complimentary-usage.ts";
import type { OpenAiComplimentaryUsageResult } from "#shared/openai-complimentary-usage.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { reconcileOpenAiComplimentaryUsage } =
  proxyActivities<OpenAiComplimentaryUsageActivities>({
    taskQueue: TASK_QUEUES.BILLING,
    startToCloseTimeout: "2 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "30 seconds",
      backoffCoefficient: 2,
      maximumInterval: "2 minutes",
    },
  });

export async function runOpenAiComplimentaryUsageReconciliation(): Promise<OpenAiComplimentaryUsageResult> {
  return await reconcileOpenAiComplimentaryUsage();
}
