import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

export const ARTIFACTS_CLEANUP_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "artifacts-cleanup",
  workflowType: "runArtifactsCleanup",
  args: [],
  timing: { kind: "interval", every: "1 hour" },
  taskQueue: TASK_QUEUES.WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  catchupWindow: "1 hour",
  workflowExecutionTimeout: "30 minutes",
  memo: "Expire upload sessions, purge archived and idle artifact boards, delete unreferenced blobs and prune events",
  initialPauseNote:
    "Awaiting artifacts activation and 100% candidate traffic for runArtifactsCleanup; stable workers do not register this Workflow",
};
