import { afterEach, beforeEach } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { scoutTaskQueues } from "#src/identifiers.ts";

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

export type ScoutScheduledWorkflowHarness = {
  /** Start the workflow worker and one `queue` Activity worker serving `activities`. */
  start: (
    activities: Record<string, (input: unknown) => unknown>,
  ) => Promise<void>;
  /** Run a Schedule-started Workflow type to completion, as the Schedule starts it. */
  run: (workflowType: string, workflowId: string) => Promise<unknown>;
};

/**
 * The time-skipping test server, worker pool and teardown shared by the
 * Workflow tests of the Schedule-started `dev` Workflows, whose input is
 * `{ stage, trigger: "schedule" }`. Call it at the top of a test file.
 */
export function useScoutScheduledWorkflowHarness(
  queue: "background" | "crawl",
): ScoutScheduledWorkflowHarness {
  const queues = scoutTaskQueues("dev");
  const workers = createScoutWorkerPool();
  let environment: TestWorkflowEnvironment | undefined;
  const current = (): TestWorkflowEnvironment => {
    if (environment === undefined) throw new Error("no test environment");
    return environment;
  };
  beforeEach(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);
  afterEach(async () => {
    await workers.drain();
    await current().teardown();
  });
  return {
    start: async (activities) => {
      await workers.start(
        await Worker.create({
          connection: current().nativeConnection,
          taskQueue: queues.workflow,
          workflowsPath: new URL("index.ts", import.meta.url).pathname,
        }),
      );
      await workers.start(
        await Worker.create({
          connection: current().nativeConnection,
          taskQueue: queues[queue],
          activities,
        }),
      );
    },
    run: (workflowType, workflowId) =>
      current().client.workflow.execute(workflowType, {
        workflowId,
        taskQueue: queues.workflow,
        args: [{ stage: "dev", trigger: "schedule" }],
      }),
  };
}
