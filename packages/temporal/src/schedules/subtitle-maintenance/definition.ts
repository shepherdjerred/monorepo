import { ScheduleOverlapPolicy } from "@temporalio/client";
import type { ScheduleDefinition } from "#schedules/schedule-types.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export const MEDIA_SUBTITLE_MAINTENANCE_SCHEDULES_V1: ScheduleDefinition[] = [
  {
    namespace: "prod",
    id: "media-subtitle-wanted-v1",
    workflowType: "maintainMediaSubtitlesV1Workflow",
    args: [{ mode: "wanted" }],
    timing: { kind: "interval", every: "6 hours" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "1 hour",
    workflowExecutionTimeout: "24 hours",
    memo: "Maintain required subtitles with actual 3-week/1-week adaptive retry history",
  },
  {
    namespace: "prod",
    id: "media-subtitle-upgrade-v1",
    workflowType: "maintainMediaSubtitlesV1Workflow",
    args: [{ mode: "upgrade" }],
    timing: { kind: "interval", every: "12 hours" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "1 hour",
    workflowExecutionTimeout: "24 hours",
    memo: "Upgrade recent 7-day sidecars, including manual origins, only with genuine higher source match scores",
  },
];
