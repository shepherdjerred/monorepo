import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

export const MEDIA_SAFETY_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "media-download-safety",
  workflowType: "runMediaDownloadSafety",
  args: [],
  timing: { kind: "interval", every: "1 minute" },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  catchupWindow: "1 minute",
  workflowExecutionTimeout: "3 minutes",
  initialPauseNote:
    "Awaiting 100% candidate traffic for runMediaDownloadSafety and a successful deployed observation canary",
  memo: "Inspect media torrent metadata, reconcile indexer protections, and reject dangerous downloads",
};
