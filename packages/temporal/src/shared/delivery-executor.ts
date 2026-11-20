/**
 * Result of running one frozen Delivery model step. `waiting` asks the
 * Workflow to poll again later; `executorReplaced` reports that a self-hosted
 * sync step's worker shut down while still holding the lease (D8), so the
 * Workflow renews the lease and runs the step again on the replacement worker
 * without failing the Temporal Activity.
 */
export type DeliveryModelStepResult = {
  waiting: boolean;
  executorReplaced?: boolean;
};

/**
 * Failure type for workflow-level executor-replacement guard violations and
 * retained replay of histories recorded before `runDeliveryModelStep` returned
 * `{ waiting: false, executorReplaced: true }` (D8).
 */
export const DELIVERY_EXECUTOR_REPLACED = "DeliveryExecutorReplaced";

/**
 * The failure type of a worker recovery proof the frozen deployment record
 * refuses: its identity, recorded stages or owned request cannot be proven.
 * A retry would read the same record, so it is never retried; any other
 * proof failure is retried while the target settles.
 */
export const DELIVERY_WORKER_RECOVERY_REFUSED = "DeliveryWorkerRecoveryRefused";
