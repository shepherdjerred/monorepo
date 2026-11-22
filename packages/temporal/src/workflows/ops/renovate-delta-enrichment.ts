import { proxyActivities } from "@temporalio/workflow";
import type {
  RenovateDeltaActivities,
  RenovateDeltaEnrichmentResult,
} from "#activities/ops/renovate-delta/renovate-delta.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { enrichRenovateVersionDeltas } =
  proxyActivities<RenovateDeltaActivities>({
    taskQueue: TASK_QUEUES.OPS,
    startToCloseTimeout: "8 minutes",
    heartbeatTimeout: "2 minutes",
    retry: {
      maximumAttempts: 2,
    },
  });

export async function runRenovateDeltaEnrichment(): Promise<RenovateDeltaEnrichmentResult> {
  return await enrichRenovateVersionDeltas();
}
