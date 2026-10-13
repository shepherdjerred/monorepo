import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

export const TRACKER_ATTACHMENT_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "tracker-staged-attachment-cleanup",
  workflowType: "runTrackerAttachmentCleanup",
  args: [],
  timing: { kind: "interval", every: "1 hour" },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  catchupWindow: "1 hour",
  workflowExecutionTimeout: "1 hour",
  memo: "Expire up to 100 uncommitted tracker attachments older than 24 hours",
  initialPauseNote:
    "Awaiting tracker activation and 100% compatible Workflow worker traffic",
};
