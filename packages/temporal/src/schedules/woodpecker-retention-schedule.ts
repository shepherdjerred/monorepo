import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

export const WOODPECKER_RETENTION_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "woodpecker-log-retention-daily",
  workflowType: "runWoodpeckerLogRetention",
  args: [{ dryRun: false, resumeScheduled: true }],
  timing: {
    kind: "cron",
    expression: "45 4 * * *",
    timezone: "America/Los_Angeles",
  },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  workflowExecutionTimeout: "24 hours",
  memo: "Daily bounded 30-day Woodpecker log retention; metadata, active PR heads and deployed artifacts protected",
  initialPauseNote:
    "Awaiting exact-candidate dry-run review and destructive retention flag approval",
};
