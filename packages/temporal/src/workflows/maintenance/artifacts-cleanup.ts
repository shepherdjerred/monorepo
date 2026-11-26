import { log, proxyActivities } from "@temporalio/workflow";
import type {
  ArtifactsCleanupActivities,
  ArtifactsCleanupResult,
} from "#activities/maintenance/artifacts/artifacts-cleanup.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { cleanupArtifacts } = proxyActivities<ArtifactsCleanupActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "2 minutes",
  retry: {
    // The next hourly Schedule retries the cleanup; a pass that failed
    // part-way is idempotent, so nothing is lost by waiting for it.
    maximumAttempts: 1,
  },
});

/** Each pass is bounded server-side; the cap keeps one run inside its timeout. */
const MAX_PASSES = 10;

export async function runArtifactsCleanup() {
  const totals: {
    status: ArtifactsCleanupResult["status"];
    passes: number;
    expiredSessions: number;
    purgedBoards: number;
    deletedBlobs: number;
    deletedOrphans: number;
    prunedEvents: number;
    more: boolean;
  } = {
    status: "ok",
    passes: 0,
    expiredSessions: 0,
    purgedBoards: 0,
    deletedBlobs: 0,
    deletedOrphans: 0,
    prunedEvents: 0,
    more: false,
  };
  while (totals.passes < MAX_PASSES) {
    const pass = await cleanupArtifacts();
    totals.passes += 1;
    totals.status = pass.status;
    totals.expiredSessions += pass.expiredSessions;
    totals.purgedBoards += pass.purgedBoards;
    totals.deletedBlobs += pass.deletedBlobs;
    totals.deletedOrphans += pass.deletedOrphans;
    totals.prunedEvents += pass.prunedEvents;
    totals.more = pass.more;
    if (pass.status === "paused" || !pass.more) break;
  }
  log.info("Artifacts cleanup", totals);
  return totals;
}
