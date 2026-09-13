import type { Worker } from "@temporalio/worker";

/**
 * The workers one test started, and the shutdown they all need.
 *
 * A Temporal Worker holds a reference to the native connection until its
 * `run()` promise settles, so a test that leaves one running makes the
 * environment's teardown throw `IllegalStateError` — and that error replaces
 * whatever the test was actually reporting. Every workflow test therefore has
 * to start workers the same way and drain them the same way, which is why this
 * is one object rather than a pattern each file copies.
 *
 * `start` waits out the `INITIALIZED` state because a worker that has not
 * begun polling yet will not pick up the task a test schedules immediately
 * after.
 */
export type ScoutWorkerPool = {
  start: (worker: Worker) => Promise<void>;
  drain: () => Promise<void>;
};

export function createScoutWorkerPool(): ScoutWorkerPool {
  const running: Worker[] = [];
  const runs: Promise<void>[] = [];
  return {
    start: async (worker) => {
      running.push(worker);
      runs.push(worker.run());
      while (worker.getState() === "INITIALIZED") {
        await new Promise(setImmediate);
      }
    },
    drain: async () => {
      for (const worker of running.splice(0)) {
        if (worker.getState() === "RUNNING") worker.shutdown();
      }
      await Promise.allSettled(runs.splice(0));
    },
  };
}
