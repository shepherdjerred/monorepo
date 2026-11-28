import { proxyActivities } from "@temporalio/workflow";
import type { renovateAutomationActivities } from "#activities/renovate/index.ts";
import type { RenovateDispatchInput } from "#activities/renovate/dispatch.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { refreshRenovateRanking } = proxyActivities<
  Pick<typeof renovateAutomationActivities, "refreshRenovateRanking">
>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "55 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 2 },
});
const { dispatchRenovateBundle } = proxyActivities<
  Pick<typeof renovateAutomationActivities, "dispatchRenovateBundle">
>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "55 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});

export async function runDailyRenovateRanking() {
  return await refreshRenovateRanking();
}

export async function runRenovateBundleDispatch(
  input: RenovateDispatchInput = {},
) {
  return await dispatchRenovateBundle(input);
}
