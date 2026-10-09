import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

export const CI_MAINTENANCE_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "ci-maintenance-dispatch",
  workflowType: "runCiMaintenanceTick",
  args: [],
  timing: { kind: "interval", every: "5 minutes" },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  workflowExecutionTimeout: "5 minutes",
  catchupWindow: "5 minutes",
  memo: "Coalesce verified-main maintenance into one lower-priority CI workflow; dispatch flag defaults off",
};
