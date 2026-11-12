type ShutdownWorker = {
  getState: () => string;
  shutdown: () => void;
};

/** Stop admission first, retain telemetry through Activity cleanup, then flush once. */
export function createWorkerShutdown(input: {
  workers: readonly ShutdownWorker[];
  runs: readonly Promise<void>[];
  closeIngress: () => Promise<void>;
  closeResources: () => Promise<void>;
  closeTracing: () => Promise<void>;
  closeCallGraph: () => Promise<void>;
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
      for (const close of [
        input.closeResources,
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
