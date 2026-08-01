import { proxyActivities } from "@temporalio/workflow";
import type {
  ObserveAgentTaskTimeoutsActivities,
  ObserveAgentTaskTimeoutsResult,
} from "#activities/observe-agent-task-timeouts.ts";

const { runObserveAgentTaskTimeouts } =
  proxyActivities<ObserveAgentTaskTimeoutsActivities>({
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
 * Guardrail: records the count of `agentTaskWorkflow` runs that timed out in the
 * last 24h on the `temporal_agent_task_timeouts_24h` gauge (alert on `> 0`).
 * See src/activities/observe-agent-task-timeouts.ts.
 */
export async function observeAgentTaskTimeoutsWorkflow(): Promise<ObserveAgentTaskTimeoutsResult> {
  return runObserveAgentTaskTimeouts();
}
