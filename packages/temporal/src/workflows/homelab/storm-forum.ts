import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type {
  ForumStage,
  StormForumActivities,
} from "@shepherdjerred/storm-forum/contracts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

function activities(stage: unknown) {
  if (stage !== "beta" && stage !== "prod") {
    throw new Error("Unknown forum stage");
  }
  return proxyActivities<StormForumActivities>({
    taskQueue:
      stage === "beta"
        ? TASK_QUEUES.STORM_FORUM_BETA
        : TASK_QUEUES.STORM_FORUM_PROD,
    startToCloseTimeout: "2 minutes",
    heartbeatTimeout: "2 minutes",
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    retry: {
      maximumAttempts: 2,
      initialInterval: "10 seconds",
      maximumInterval: "30 seconds",
    },
  });
}

export async function maintainStormForumWorkflow(
  stage: ForumStage,
): Promise<void> {
  await activities(stage).maintainStormForum();
}
