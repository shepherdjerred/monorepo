import { ScheduleOverlapPolicy } from "@temporalio/client";
import type { ScheduleDefinition } from "#schedules/schedule-types.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export const MEDIA_QUALITY_GUIDE_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "media-quality-guide",
  workflowType: "refreshMediaQualityGuidesWorkflow",
  args: [],
  timing: { kind: "interval", every: "24 hours" },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  catchupWindow: "1 hour",
  workflowExecutionTimeout: "25 minutes",
  memo: "Validate selected TRaSH guide changes and preserve the last good household profile and explicit overrides",
};
