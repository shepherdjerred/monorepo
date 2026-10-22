import { log, proxyActivities } from "@temporalio/workflow";
import type { RwfRecordingArchiveActivities } from "#activities/homelab/rwf/recording-archive.ts";
import type { RwfArchiveResult } from "#shared/rwf-recording-archive.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

/** How many recordings one run archives at most; the next scheduled run continues. */
const BATCH = 25;

// The Storm worker on this queue already holds the narrow exec grant on the
// Minecraft pod that reading recordings and writing markers needs.
const { archiveRwfRecordings } = proxyActivities<RwfRecordingArchiveActivities>(
  {
    taskQueue: TASK_QUEUES.MINING_RESET,
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "5 minutes",
    retry: { maximumAttempts: 3, initialInterval: "1 minute" },
  },
);

/**
 * Copies finished Red Warfare recordings to object storage and marks each one
 * archived on the server once its copy is confirmed; the plugin's retention
 * deletes only marked recordings.
 */
export async function runRwfRecordingArchiveWorkflow(): Promise<RwfArchiveResult> {
  const result = await archiveRwfRecordings(BATCH);
  log.info("Red Warfare recording archive", { ...result });
  return result;
}
