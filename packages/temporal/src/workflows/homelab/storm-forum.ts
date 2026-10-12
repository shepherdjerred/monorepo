import {
  ActivityCancellationType,
  CancellationScope,
  proxyActivities,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import type {
  ForumStage,
  StormForumActivities,
} from "@shepherdjerred/storm-forum/contracts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

function activities(stage: unknown, snapshot = false) {
  if (stage !== "beta" && stage !== "prod") {
    throw new Error("Unknown forum stage");
  }
  return proxyActivities<StormForumActivities>({
    taskQueue:
      stage === "beta"
        ? TASK_QUEUES.STORM_FORUM_BETA
        : TASK_QUEUES.STORM_FORUM_PROD,
    startToCloseTimeout: snapshot ? "20 minutes" : "2 minutes",
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

export async function backupStormForumWorkflow(
  stage: ForumStage,
): Promise<{ manifestKey: string }> {
  const worker = activities(stage);
  const owner = workflowInfo().runId;
  // Compensate even if the execution is cancelled while waiting for requests to drain.
  try {
    await worker.beginStormForumBackup(owner);
    await sleep("65 seconds");
    return await activities(stage, true).snapshotStormForum(owner);
  } finally {
    await CancellationScope.nonCancellable(async () => {
      await worker.endStormForumBackup(owner);
    });
  }
}
