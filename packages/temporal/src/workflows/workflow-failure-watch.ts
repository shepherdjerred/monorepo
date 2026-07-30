import { proxyActivities } from "@temporalio/workflow";
import type {
  PollWorkflowFailuresResult,
  WorkflowFailureWatchActivities,
} from "#activities/workflow-failure-watch.ts";

const { pollWorkflowFailures } =
  proxyActivities<WorkflowFailureWatchActivities>({
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
 * timed out in the last ~15 minutes and pages PagerDuty (via Alertmanager)
 * with the specific error for each one. See
 * src/activities/workflow-failure-watch.ts.
 */
export async function pollWorkflowFailuresWorkflow(): Promise<PollWorkflowFailuresResult> {
  return pollWorkflowFailures();
}
