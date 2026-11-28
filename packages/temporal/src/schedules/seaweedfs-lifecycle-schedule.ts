import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

export const SEAWEEDFS_LIFECYCLE_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "seaweedfs-lifecycle-enforcer",
  workflowType: "runSeaweedfsLifecycleEnforcer",
  args: [{ dryRun: false }],
  timing: {
    kind: "cron",
    expression: "30 4 * * *",
    timezone: "America/Los_Angeles",
  },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  // A first sweep lists every bucket's expired prefixes in eight-minute
  // chunks; the daily cadence and SKIP overlap make the wide ceiling harmless.
  workflowExecutionTimeout: "12 hours",
  memo: "Daily enforcement of every SeaweedFS lifecycle Expiration rule, which SeaweedFS stores but never applies; reports only until the mode flag is delete",
  initialPauseNote:
    "Awaiting dry-run report review and the seaweedfs-lifecycle-enforcer-mode delete flag",
};
