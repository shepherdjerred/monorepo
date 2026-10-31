import { AsyncLocalStorage } from "node:async_hooks";
import { Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";

/** The running model step's lease-loss signal, set by `withLeaseRenewal`. */
const leaseLoss = new AsyncLocalStorage<AbortSignal>();

/**
 * The signal every external effect of a model step passes on (D7). It
 * aborts when the Activity is cancelled or when this executor loses the
 * deployment's lease, so a long sync, publish, Job wait or bucket write
 * stops instead of acting after recovery took the deployment. A step reads
 * it wherever it would read the Activity's cancellation signal; outside a
 * step, which holds no lease, it is that cancellation signal.
 */
export function effectSignal(): AbortSignal {
  const cancellation = Context.current().cancellationSignal;
  const lost = leaseLoss.getStore();
  return lost === undefined
    ? cancellation
    : AbortSignal.any([cancellation, lost]);
}

/**
 * The Activity's heartbeat with `effectSignal` as its cancellation, for
 * helpers that take an Activity context (`withBackupActivityHeartbeat`).
 */
export function effectContext() {
  const context = Context.current();
  return {
    cancellationSignal: effectSignal(),
    heartbeat: (details: unknown) => {
      context.heartbeat(details);
    },
  };
}

/**
 * Whether this Activity was cancelled because its own worker is shutting
 * down while the step still held its lease. The SDK cancels every running
 * Activity with a `WORKER_SHUTDOWN` CancelledFailure on worker shutdown, so
 * `effectSignal` killed the step's effects; nothing about the target was
 * decided. A lost lease, a requested cancellation or a timeout is never this.
 */
export function interruptedByWorkerShutdown(): boolean {
  const reason: unknown = Context.current().cancellationSignal.reason;
  return (
    reason instanceof CancelledFailure &&
    reason.message === "WORKER_SHUTDOWN" &&
    leaseLoss.getStore()?.aborted !== true
  );
}

/** Runs one step with `lost` as the lease-loss half of its `effectSignal`. */
export async function withLeaseLoss<T>(
  lost: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  return await leaseLoss.run(lost, run);
}
