import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { schedulesInNamespace } from "./schedule-types.ts";

export const STORM_FORUM_SCHEDULES = schedulesInNamespace(
  "prod",
  (["beta", "prod"] as const).flatMap((stage) => [
    {
      id: `storm-forum-${stage}-housekeeping`,
      workflowType: "maintainStormForumWorkflow",
      args: [stage],
      timing: {
        kind: "cron" as const,
        expression: "* * * * *",
        timezone: "America/Los_Angeles",
      },
      taskQueue: TASK_QUEUES.WORKFLOWS,
      overlap: ScheduleOverlapPolicy.SKIP,
      workflowExecutionTimeout: "5 minutes" as const,
      memo: "XenForo deferred jobs, managed registration policy, and direct Minecraft backend status",
      initialPauseNote: "Awaiting private forum release and worker acceptance",
    },
    {
      id: `storm-forum-${stage}-backup`,
      workflowType: "backupStormForumWorkflow",
      args: [stage],
      timing: {
        kind: "cron" as const,
        expression: "15 3 * * *",
        timezone: "America/Los_Angeles",
      },
      taskQueue: TASK_QUEUES.WORKFLOWS,
      overlap: ScheduleOverlapPolicy.SKIP,
      workflowExecutionTimeout: "50 minutes" as const,
      memo: "Coordinated forum database and writable-file export with a bounded maintenance window",
      initialPauseNote:
        "Awaiting complete snapshot and protected test restore acceptance",
    },
  ]),
);
