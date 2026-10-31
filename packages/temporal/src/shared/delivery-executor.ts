/**
 * The failure type of a self-hosted sync step interrupted by its own
 * executor's replacement (D8): the worker running the step shut down while
 * the step still held the lease. The step's stage stays `running`, and the
 * deployment Workflow runs the same step again on the replacement worker,
 * which reads back the recorded request instead of syncing twice.
 */
export const DELIVERY_EXECUTOR_REPLACED = "DeliveryExecutorReplaced";
