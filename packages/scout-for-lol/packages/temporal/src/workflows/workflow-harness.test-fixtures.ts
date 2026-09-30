import { afterEach, beforeEach } from "vitest";
import { WorkflowFailedError, type Client } from "@temporalio/client";
import { ApplicationFailure, type Duration } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { ScoutPostMatchDiscoveryOwnerV2Result } from "#src/activity-contracts-v2.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

/**
 * How a V2 Workflow test drives an execution and reads what it did.
 *
 * Every V2 lane's tests stand up the same time-skipping environment and the
 * same pair of workers, and tear them down in the same order, so this is one
 * module rather than a shape each file copies. Getting the teardown wrong is
 * not a cosmetic mistake: a worker left running holds the native connection
 * and makes `teardown` throw `IllegalStateError`, which then replaces whatever
 * the test was actually reporting.
 */

export type ScoutV2WorkflowHarness = {
  /** The client for the environment of the test currently running. */
  client: () => Client;
  /**
   * Advance the time-skipping server's clock, for a test about what a
   * Workflow does while something it waits on is still running.
   */
  sleep: (duration: Duration) => Promise<void>;
  /**
   * One Workflow worker and one realtime Activity worker, on the queues
   * `scoutTaskQueues("dev")` names.
   *
   * The SDK refuses a second worker on a task queue already served in this
   * process, so every scenario in a file — including a crash and its replay —
   * runs against a single Activity registration whose behaviour comes from the
   * store it closes over. That is also why the workflow suite runs with
   * `--no-file-parallelism`.
   */
  startWorkers: (activities: object) => Promise<void>;
};

const V2_OWNS_DISCOVERY = {
  resolvePostMatchDiscoveryOwnerV2:
    (): ScoutPostMatchDiscoveryOwnerV2Result => ({
      decision: "run-v2",
    }),
};

/**
 * Register the per-test environment lifecycle and return the handle tests
 * drive it through.
 *
 * Called once at module scope. The environment is rebuilt per test so no
 * scenario inherits another's executions, and the workers are drained before
 * it is torn down.
 */
export function useScoutV2WorkflowHarness(): ScoutV2WorkflowHarness {
  const pool = createScoutWorkerPool();
  let environment: TestWorkflowEnvironment | null = null;

  beforeEach(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);

  afterEach(async () => {
    await pool.drain();
    await environment?.teardown();
    environment = null;
  });

  const current = (): TestWorkflowEnvironment => {
    if (environment === null) {
      throw new Error(
        "The Scout V2 workflow harness is only live inside a test",
      );
    }
    return environment;
  };

  return {
    client: () => current().client,
    sleep: async (duration) => {
      await current().sleep(duration);
    },
    startWorkers: async (activities) => {
      const live = current();
      await pool.start(
        await Worker.create({
          connection: live.nativeConnection,
          taskQueue: "scout-dev",
          workflowsPath: new URL("index.ts", import.meta.url).pathname,
          maxConcurrentWorkflowTaskExecutions: 4,
        }),
      );
      await pool.start(
        await Worker.create({
          connection: live.nativeConnection,
          taskQueue: "scout-dev-realtime",
          // Every discovery asks who owns the pass before it does anything
          // else. The answer defaults to V2, as the flag does in production;
          // a test about the v1 handoff overrides it.
          activities: { ...V2_OWNS_DISCOVERY, ...activities },
          maxConcurrentActivityTaskExecutions: 4,
        }),
      );
    },
  };
}

/**
 * The `ApplicationFailure` behind a settled Workflow execution, or `null`.
 *
 * Returning rather than asserting keeps the caller's expectations about the
 * failure — its type, whether it is retryable, what it said — in the test that
 * cares, while the two unwrapping steps every such assertion needs happen once
 * here. A value that is not a failed execution at all comes back `null`, so a
 * Workflow that wrongly SUCCEEDED fails the caller's first assertion instead
 * of throwing somewhere less legible.
 */
export function applicationFailureOf(
  settled: unknown,
): ApplicationFailure | null {
  if (!(settled instanceof WorkflowFailedError)) return null;
  return settled.cause instanceof ApplicationFailure ? settled.cause : null;
}

/** Settle a Workflow promise into its value or its error, without throwing. */
export async function settleWorkflow(
  execution: Promise<unknown>,
): Promise<unknown> {
  return await execution.then(
    (value: unknown) => value,
    (error: unknown) => error,
  );
}
