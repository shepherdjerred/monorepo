/**
 * The failure type of a self-hosted sync step interrupted by its own
 * executor's replacement (D8): the worker running the step shut down while
 * the step still held the lease. The step's stage stays `running`, and the
 * deployment Workflow runs the same step again on the replacement worker,
 * which reads back the recorded request instead of syncing twice.
 */
export const DELIVERY_EXECUTOR_REPLACED = "DeliveryExecutorReplaced";

/**
 * The failure type of a worker recovery proof the frozen deployment record
 * refuses: its identity, recorded stages or owned request cannot be proven.
 * A retry would read the same record, so it is never retried; any other
 * proof failure is retried while the target settles.
 */
export const DELIVERY_WORKER_RECOVERY_REFUSED = "DeliveryWorkerRecoveryRefused";
