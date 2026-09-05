import { log, proxyActivities } from "@temporalio/workflow";
import type {
  ScoutImageGcActivities,
  ScoutImageGcInput,
  ScoutImageGcResult,
} from "#activities/scout/scout-image-gc.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { pruneScoutImages } = proxyActivities<ScoutImageGcActivities>({
  taskQueue: TASK_QUEUES.SCOUT,
  // The initial sweep lists ~110k objects across both buckets and deletes the
  // ~38k images older than the retention window; list + batched DeleteObjects
  // are fast, but the first run does the bulk of the work. Steady-state nightly
  // runs finish in well under a minute. Generous ceiling for the first run.
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30s",
    backoffCoefficient: 2,
    maximumInterval: "5 minutes",
  },
});

export async function runScoutImageGcWorkflow(
  input: ScoutImageGcInput = {},
): Promise<ScoutImageGcResult> {
  const result = await pruneScoutImages(input);
  log.info("Scout image garbage collection complete", {
    totalMatched: result.totalMatched,
    totalDeleted: result.totalDeleted,
    totalBytesReclaimed: result.totalBytesReclaimed,
    dryRun: result.dryRun,
  });
  return result;
}
