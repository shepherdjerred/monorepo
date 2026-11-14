type ShutdownWorker = {
  getState: () => string;
  shutdown: () => void;
};

/**
 * Stop admission first, retain telemetry through Activity cleanup, then flush
 * once. The drain (every `run()` settling) is never bounded here: the pod's
 * termination grace owns that. `afterDrain` marks the moment it completes, so
 * the caller can bound the cleanup that follows.
 */
export function createWorkerShutdown(input: {
  workers: readonly ShutdownWorker[];
  runs: readonly Promise<void>[];
  closeIngress: () => Promise<void>;
  closeResources: () => Promise<void>;
  /** An open Temporal connection keeps the SDK runtime, and so the process, alive. */
  closeConnections: () => Promise<void>;
  closeTracing: () => Promise<void>;
  closeCallGraph: () => Promise<void>;
  afterDrain?: () => void;
}) {
  let pending: Promise<void> | undefined;
  return (): Promise<void> => {
    pending ??= (async () => {
      const failures: unknown[] = [];
      for (const worker of input.workers)
        if (worker.getState() === "RUNNING") {
          try {
            worker.shutdown();
          } catch (error) {
            failures.push(error);
          }
        }
      try {
        await input.closeIngress();
      } catch (error) {
        failures.push(error);
      }
      // run() settles only after Activities have finished (DRAINED alone is not enough).
      await Promise.allSettled(input.runs);
      input.afterDrain?.();
      for (const close of [
        input.closeResources,
        input.closeConnections,
        input.closeTracing,
        input.closeCallGraph,
      ]) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, "Worker shutdown failed");
    })();
    return pending;
  };
}
