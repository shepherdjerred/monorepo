import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { schedulesInNamespace } from "./schedule-types.ts";

export const MINECRAFT_SCHEDULES = schedulesInNamespace("prod", [
  {
    id: "the-storm-shop-reconciliation",
    workflowType: "runStormPlotReconciliationWorkflow",
    args: [],
    timing: { kind: "interval", every: "15 minutes" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "5 minutes",
    workflowExecutionTimeout: "12 minutes",
    memo: "Recover expired shop rentals and interrupted placements; skip hibernated servers without waking them",
    initialPauseNote:
      "Awaiting real-server recovery rehearsal and live plugin acceptance",
  },
  {
    id: "the-storm-companion-core-hours",
    workflowType: "reconcileStormCompanionsWorkflow",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 14,22 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "5 minutes",
    memo: "Reconcile Citizens companions at Pacific core-hour boundaries without waking the server",
    initialPauseNote:
      "Awaiting Citizens survival rollout and real-server acceptance",
  },
  {
    id: "the-storm-rwf-recording-archive",
    workflowType: "runRwfRecordingArchiveWorkflow",
    args: [],
    timing: { kind: "interval", every: "1 hour" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "5 minutes",
    workflowExecutionTimeout: "2 hours",
    memo: "Archive finished Red Warfare recordings to object storage and mark them so the plugin may prune them; skip hibernated servers without waking them",
    initialPauseNote:
      "Awaiting 100% candidate traffic for runRwfRecordingArchiveWorkflow and a successful recording archive canary",
  },
]);
