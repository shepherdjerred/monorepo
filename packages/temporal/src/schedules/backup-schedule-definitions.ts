import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

const INITIAL_PAUSE_NOTE =
  "Awaiting coverage inventory, bootstrap verification, and acceptance restores";

export const BACKUP_SCHEDULES: ScheduleDefinition[] = [
  {
    id: "seaweedfs-backup-six-hourly",
    namespace: "prod",
    workflowType: "runSeaweedFsBackupWorkflow",
    args: [{ cadence: "six-hourly" }],
    timing: {
      kind: "cron",
      expression: "0 */6 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "5 hours",
    memo: "Six-hourly off-site object backup for critical SeaweedFS buckets",
    initialPauseNote: INITIAL_PAUSE_NOTE,
  },
  {
    id: "seaweedfs-backup-daily",
    namespace: "prod",
    workflowType: "runSeaweedFsBackupWorkflow",
    args: [{ cadence: "daily" }],
    timing: {
      kind: "cron",
      expression: "30 11 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "20 hours",
    memo: "Daily off-site object backup for the protected SeaweedFS set",
    initialPauseNote: INITIAL_PAUSE_NOTE,
  },
  {
    id: "seaweedfs-backup-retention-gc-weekly",
    namespace: "prod",
    workflowType: "runSeaweedFsBackupRetentionAndGcWorkflow",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 14 * * 0",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "12 hours",
    memo: "Weekly SeaweedFS backup GFS retention and two-phase garbage collection",
    initialPauseNote: INITIAL_PAUSE_NOTE,
  },
];
