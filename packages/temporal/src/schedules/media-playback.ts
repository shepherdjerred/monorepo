import { ScheduleOverlapPolicy } from "@temporalio/client";
import type { ScheduleDefinition } from "./schedule-types.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export const MEDIA_PLAYBACK_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "media-playback",
  workflowType: "reconcileMediaPlaybackWorkflow",
  args: [],
  timing: { kind: "interval", every: "1 minute" },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  catchupWindow: "1 minute",
  workflowExecutionTimeout: "5 minutes",
  initialPauseNote:
    "AI-605: awaiting final historical playback snapshot and sealed legacy handoff",
  memo: "Reconcile whole-library playback history separately from watched and file authority",
};
