import { proxyActivities } from "@temporalio/workflow";
import type { CancelCiPipelinesActivities } from "#activities/cancel-ci-pipelines.ts";
import type { CancelCiPipelinesInput } from "#shared/schemas.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { cancelCiPipelinesForBranch } =
  proxyActivities<CancelCiPipelinesActivities>({
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    startToCloseTimeout: "2 minutes",
    retry: {
      maximumAttempts: 5,
      initialInterval: "2s",
      backoffCoefficient: 2,
      maximumInterval: "30s",
    },
  });

/**
 * Cancel any still-active Buildkite builds for a closed/merged PR's branch.
 * Started by the GitHub webhook on the `closed` action — see
 * src/event-bridge/github-webhook.ts.
 */
export async function cancelCiPipelinesWorkflow(
  input: CancelCiPipelinesInput,
): Promise<void> {
  await cancelCiPipelinesForBranch(input);
}
