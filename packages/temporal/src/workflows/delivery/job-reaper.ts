import { TimeoutFailure, TimeoutType } from "@temporalio/common";
import {
  ActivityFailure,
  patched,
  proxyActivities,
} from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";
import type { PlatformDeliveryActivities } from "#activities/delivery/platform/index.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

/**
 * Once per dispatch tick, after dispatch and observations: terminal stage Jobs
 * whose deployments have settled without recoveryRequired or pending recovery
 * intents are reaped from each worker's own Job namespace (AI-523). Ticks
 * recorded before it replay without these Activities.
 */
export const DELIVERY_JOB_REAPER_PATCH = "delivery-job-reaper-v1";

const workerJobReaper = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5s",
    maximumInterval: "20s",
    maximumAttempts: 2,
  },
});

// `delivery-platform` runs maxConcurrentActivityTaskExecutions=1 so a multi-minute
// platform release holds its single slot; a short schedule-to-start timeout lets
// dispatch defer platform reaping while busy instead of stalling the tick.
const platformJobReaper = proxyActivities<PlatformDeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY_PLATFORM,
  scheduleToStartTimeout: "15 seconds",
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5s",
    maximumInterval: "20s",
    maximumAttempts: 2,
  },
});

function isBusyQueueTimeout(error: unknown): boolean {
  return (
    error instanceof ActivityFailure &&
    error.cause instanceof TimeoutFailure &&
    error.cause.timeoutType === TimeoutType.SCHEDULE_TO_START
  );
}

export async function reapSettledJobs(): Promise<unknown[]> {
  if (!patched(DELIVERY_JOB_REAPER_PATCH)) {
    return [];
  }
  const outcomes = await Promise.allSettled([
    workerJobReaper.reapSettledDeliveryWorkerJobs(),
    platformJobReaper.reapSettledDeliveryPlatformJobs(),
  ]);
  const failures: unknown[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "rejected" && !isBusyQueueTimeout(outcome.reason)) {
      failures.push(outcome.reason);
    }
  }
  return failures;
}
