import {
  CancellationScope,
  patched,
  proxyActivities,
} from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";
import { DELIVERY_WORKER_RECOVERY_REFUSED } from "#shared/delivery-executor.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

/**
 * Worker recovery proof is read-only, so a Kubernetes API or Delivery API
 * that is briefly unreachable is waited out rather than failing the intent
 * (AI-496). A refusal the frozen record decides is non-retryable; the
 * attempt and schedule-to-close bounds end an outage that persists. Runs
 * recorded before the patch keep the observation options they scheduled.
 */
const DELIVERY_WORKER_RECOVERY_RETRY_PATCH =
  "delivery-worker-recovery-retry-v1";

const inspection = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "25 minutes",
  scheduleToCloseTimeout: "60 minutes",
  retry: {
    maximumAttempts: 10,
    initialInterval: "10 seconds",
    maximumInterval: "2 minutes",
    nonRetryableErrorTypes: [DELIVERY_WORKER_RECOVERY_REFUSED],
  },
});
/** The Delivery Workflow's observation options, which earlier runs recorded. */
const recorded = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "25 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    maximumInterval: "30 seconds",
  },
});
const metadata = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "30 seconds",
  },
});

/**
 * The worker recovery Workflow's body: inspect the intent, and record its
 * failure, without releasing anything, when the proof does not succeed.
 */
export async function inspectWorkerRecovery(intentId: string): Promise<void> {
  const activities = patched(DELIVERY_WORKER_RECOVERY_RETRY_PATCH)
    ? inspection
    : recorded;
  try {
    await activities.inspectDeliveryWorkerRecovery(intentId);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryWorkerRecovery(intentId);
    });
    throw error;
  }
}
