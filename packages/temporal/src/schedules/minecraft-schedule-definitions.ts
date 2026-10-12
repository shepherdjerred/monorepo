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
    id: "the-storm-mining-reset-countdown",
    workflowType: "announceStormMiningResetCountdownWorkflow",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 17 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "15 minutes",
    memo: "Warn The Storm's Discord a week and a day before an unpaused mining reset; posts through the bridge bot without waking the server",
    initialPauseNote:
      "Awaiting the infra worker's Storm Discord credential rollout and a live channel post check",
  },
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
  {
    id: "the-storm-rwf-recording-archive",
    workflowType: "runRwfRecordingArchiveWorkflow",
    args: [],
    timing: { kind: "interval", every: "1 hour" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "5 minutes",
    workflowExecutionTimeout: "2 hours",
    // Runs unpaused; the-storm-rwf-recording-archive-enabled gates each run.
    memo: "Archive finished Red Warfare recordings to object storage and mark them so the plugin may prune them; skip hibernated servers without waking them",
  },
]);
