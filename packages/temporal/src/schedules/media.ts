import { ScheduleOverlapPolicy } from "@temporalio/client";
import type { ScheduleDefinition } from "./schedule-types.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { Duration } from "@temporalio/common";

const cadences: { kind: string; every: Duration }[] = [
  { kind: "downloads", every: "1 minute" },
  { kind: "watch", every: "5 minutes" },
  { kind: "feeds", every: "15 minutes" },
  { kind: "due", every: "6 hours" },
  { kind: "inventory", every: "24 hours" },
];

export const MEDIA_SCHEDULES: ScheduleDefinition[] = [
  {
    namespace: "prod",
    id: "media-capacity",
    workflowType: "observeMediaCapacityWorkflow",
    args: [],
    timing: { kind: "interval", every: "1 minute" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "1 minute",
    workflowExecutionTimeout: "3 minutes",
    initialPauseNote:
      "Awaiting capacity observation acceptance and compatible workers",
    memo: "Observe canonical media library capacity without granting file authority",
  },
  {
    namespace: "prod",
    id: "media-outbox",
    workflowType: "dispatchMediaOutboxWorkflow",
    args: [],
    timing: { kind: "interval", every: "1 minute" },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "5 minutes",
    workflowExecutionTimeout: "10 minutes",
    initialPauseNote: "Awaiting media database and compatible workers",
    memo: "Dispatch durable media commands",
  },
  ...cadences.map((entry): ScheduleDefinition => ({
    namespace: "prod",
    id: `media-${entry.kind}`,
    workflowType: "sweepMediaWorkflow",
    args: [{ kind: entry.kind }],
    timing: { kind: "interval", every: entry.every },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "5 minutes",
    workflowExecutionTimeout: "1 hour",
    initialPauseNote: "Awaiting media database and compatible workers",
    memo: `Bounded media ${entry.kind} reconciliation`,
  })),
];
