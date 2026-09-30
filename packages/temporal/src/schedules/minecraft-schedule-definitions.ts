import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { schedulesInNamespace } from "./schedule-types.ts";

export const MINECRAFT_SCHEDULES = schedulesInNamespace("prod", [
  {
    id: "the-storm-mining-reset-quarterly",
    workflowType: "runMiningWorldResetWorkflow",
    args: [],
    timing: {
      kind: "cron",
      // The Activity uses its own queue so it cannot delay 05:30–07:30 infra audits.
      expression: "15 5 1 1,4,7,10 *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "7 hours",
    memo: "Reset The Storm's disposable mining world after an isolated Velero PVC snapshot while the server is hibernated",
    initialPauseNote:
      "Awaiting restored-backup rehearsal, reset Job dry run, and live server/world rollout acceptance",
  },
]);
