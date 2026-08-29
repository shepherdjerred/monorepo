import { proxyActivities } from "@temporalio/workflow";
import type { PollWorkflowFailuresResult } from "#activities/workflow-failure-watch.ts";
import type { WorkflowFailureWatchActivities } from "#activities/workflow-failure-watch-activity.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { pollWorkflowFailures } =
  proxyActivities<WorkflowFailureWatchActivities>({
    taskQueue: TASK_QUEUES.REPORTS,
    startToCloseTimeout: "2 minutes",
    heartbeatTimeout: "30 seconds",
    retry: {
      maximumAttempts: 3,
      initialInterval: "10s",
      backoffCoefficient: 2,
      maximumInterval: "60s",
    },
  });

/**
 * Polls the Temporal visibility API for workflow executions that failed or
 * timed out in the last 24 hours and notifies Alerts (via Alertmanager) with
 * the specific error for each one. See
 * src/activities/workflow-failure-watch-activity.ts.
 */
export async function pollWorkflowFailuresWorkflow(): Promise<PollWorkflowFailuresResult> {
  return pollWorkflowFailures();
}
