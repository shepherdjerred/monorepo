import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

export const CI_WORKSPACE_REAPER_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "ci-workspace-reaper",
  workflowType: "runCiWorkspaceReaperWorkflow",
  args: [],
  timing: {
    kind: "cron",
    expression: "*/15 * * * *",
    timezone: "America/Los_Angeles",
  },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  // The infra queue runs one Activity at a time, and its longest Activity (the
  // homelab audit agent) can hold it for 45 minutes before this five-minute
  // reap starts.
  workflowExecutionTimeout: "1 hour",
  memo: "Every-15-minute deletion of Woodpecker step pods and workspace claims older than any workflow",
  // Registered paused: stable workers do not register this Workflow, so a run
  // could reach an incompatible stable worker. Unpause once the candidate
  // carrying it receives 100% of traffic.
  initialPauseNote:
    "Awaiting 100% candidate traffic for runCiWorkspaceReaperWorkflow; stable workers do not register this Workflow",
};
