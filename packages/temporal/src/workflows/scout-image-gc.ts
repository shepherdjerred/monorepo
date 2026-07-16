import { proxyActivities } from "@temporalio/workflow";
import type {
  ScoutImageGcActivities,
  ScoutImageGcInput,
  ScoutImageGcResult,
} from "#activities/scout-image-gc.ts";

const { pruneScoutImages } = proxyActivities<ScoutImageGcActivities>({
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
  console.warn(
    `[scout-image-gc] complete: matched=${String(result.totalMatched)} deleted=${String(result.totalDeleted)} bytes=${String(result.totalBytesReclaimed)} dryRun=${String(result.dryRun)}`,
  );
  return result;
}
