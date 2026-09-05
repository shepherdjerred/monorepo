import { proxyActivities } from "@temporalio/workflow";
import type {
  GlitterContextRefreshActivities,
  GlitterContextRefreshInput,
  GlitterContextRefreshResult,
} from "#activities/glitter/context/glitter-context-refresh.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { refreshGlitterContext } =
  proxyActivities<GlitterContextRefreshActivities>({
    taskQueue: TASK_QUEUES.GLITTER_CONTEXT,
    // The weekly schedule's 15h workflow deadline accommodates both complete
    // attempts plus the retry backoff.
    startToCloseTimeout: "7 hours",
    heartbeatTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "2 minutes",
      backoffCoefficient: 2,
      maximumInterval: "10 minutes",
    },
  });

export async function runGlitterContextRefresh(
  input: GlitterContextRefreshInput = {},
): Promise<GlitterContextRefreshResult> {
  return await refreshGlitterContext(input);
}
