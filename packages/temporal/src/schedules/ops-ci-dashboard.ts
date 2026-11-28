import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleSourceDefinition } from "./schedule-types.ts";

export const OPS_CI_DASHBOARD_SCHEDULES = [
  {
    id: "ops-ci-dashboard",
    workflowType: "runOpsCiDashboard",
    args: [],
    timing: { kind: "interval", every: "1 minute" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "1 minute",
    workflowExecutionTimeout: "45 seconds",
    memo: "Collect the Woodpecker queue, monorepo jobs, and Kueue admission for Hub",
  },
  {
    id: "ops-ci-dashboard-timings",
    workflowType: "runOpsCiDashboardTimings",
    args: [],
    timing: { kind: "interval", every: "15 minutes", offset: "30 seconds" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "5 minutes",
    workflowExecutionTimeout: "2 minutes",
    memo: "Refresh historical Woodpecker workflow and PR completion timings for Hub",
  },
] satisfies readonly ScheduleSourceDefinition[];
