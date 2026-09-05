import type { WorkerOptions } from "@temporalio/worker";

/**
 * Keep workflow caching enabled while explicitly configuring a valid poller
 * count for Temporal Core. This avoids the Bun/Core default-translation path
 * that can otherwise create a one-poller worker, which Core rejects when the
 * workflow cache is non-empty.
 */
export const WORKFLOW_TASK_POLLER_BEHAVIOR: NonNullable<
  WorkerOptions["workflowTaskPollerBehavior"]
> = {
  type: "simple-maximum",
  maximum: 10,
};
