import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { schedulesInNamespace } from "./schedule-types.ts";

export const SECURITY_SCHEDULES = schedulesInNamespace("prod", [
  {
    id: "main-vuln-scan-weekly",
    workflowType: "runMainVulnScanWorkflow",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 5 * * 0",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "2 hours",
    memo: "Weekly Trivy HIGH/CRITICAL vulnerability scan of main with report delivery",
  },
  {
    id: "link-rot-scan-weekly",
    workflowType: "runLinkRotScanWorkflow",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 9 * * 0",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "4 hours",
    memo: "Weekly lychee link-rot scan of main's tracked markdown with report delivery",
  },
]);
