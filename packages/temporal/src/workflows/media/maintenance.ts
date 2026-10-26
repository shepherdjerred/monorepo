import {
  CancellationScope,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type {
  PlexExclusionNetworkActivities,
  PlexExclusionFileActivities,
  PlexExclusionOperation,
} from "@shepherdjerred/media/plex-exclusion";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";

const network = proxyActivities<PlexExclusionNetworkActivities>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "10 minutes",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  heartbeatTimeout: "1 minute",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    maximumInterval: "30 seconds",
  },
});
const files = proxyActivities<PlexExclusionFileActivities>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 3, initialInterval: "5 seconds" },
});

export async function preparePlexExclusionWorkflow(
  input: PlexExclusionOperation,
): Promise<void> {
  try {
    await network.preparePlexExclusionTopology(input);
    await files.preparePlexExclusionFiles(input);
  } catch {
    await CancellationScope.nonCancellable(() =>
      network.recordPlexExclusionIntervention(input),
    );
  }
}

export async function executePlexExclusionWorkflow(
  input: PlexExclusionOperation,
): Promise<void> {
  try {
    await network.validatePlexExclusionExecution(input);
    await files.stagePlexExclusionFiles(input);
    await reconcile(input, false);
    await files.cleanupPlexExclusionFiles(input);
    await reconcile(input, true);
    await network.finishPlexExclusion(input);
  } catch {
    await CancellationScope.nonCancellable(async () => {
      try {
        await files.cleanupPlexExclusionFiles(input);
      } finally {
        await network.recordPlexExclusionIntervention(input);
      }
    });
  }
}
async function reconcile(
  input: PlexExclusionOperation,
  cleanup: boolean,
): Promise<void> {
  for (let iteration = 0; iteration < 44; iteration++) {
    const result = await network.reconcilePlexExclusionScan({
      ...input,
      cleanup,
    });
    if (result.state !== "waiting") return;
    await sleep("15 seconds");
  }
  throw new Error("Plex scan observation deadline exceeded");
}

/** Recovery retains every sending/unknown effect journal; it only cleans owned probes and reconciles observations. */
export async function recoverPlexExclusionWorkflow(
  input: PlexExclusionOperation,
): Promise<void> {
  try {
    await network.validatePlexExclusionExecution(input);
    await files.cleanupPlexExclusionFiles(input);
    await reconcile(input, true);
    await network.finishPlexExclusion(input);
  } catch {
    await CancellationScope.nonCancellable(() =>
      network.recordPlexExclusionIntervention(input),
    );
  }
}
