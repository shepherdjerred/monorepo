import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

// Every 5 minutes. The activity looks back 24 hours so a worker outage can be
// recovered by the next poll; the matching alert TTL prevents duplicate pages.
// Its three-attempt retry budget is about 6.5 minutes, so the eight-minute
// execution timeout gives it margin while SKIP overlap guards the cadence.
export const TEMPORAL_FAILURE_WATCH_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "temporal-failure-watch",
  workflowType: "pollWorkflowFailuresWorkflow",
  args: [],
  timing: {
    kind: "cron",
    expression: "*/5 * * * *",
    timezone: "America/Los_Angeles",
  },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  workflowExecutionTimeout: "8 minutes",
  memo: "Notifies Alerts (via Alertmanager) with the specific error for every Temporal workflow execution that failed or timed out.",
};
