import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { requestStopSignal } from "#src/signals.ts";
import {
  scoutInitialHistoryWorkflow,
  scoutInteractiveRunWorkflow,
  scoutPostMatchDiscoveryWorkflow,
  scoutRealtimePollWorkflow,
} from "./index.ts";

let environment: TestWorkflowEnvironment;
const runningWorkers: Worker[] = [];
const workerRuns: Promise<void>[] = [];

function workflowWorker(): Promise<Worker> {
  return Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev",
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
    maxConcurrentWorkflowTaskExecutions: 4,
  });
}

async function startWorker(worker: Worker): Promise<void> {
  runningWorkers.push(worker);
  workerRuns.push(worker.run());
  while (worker.getState() === "INITIALIZED") await new Promise(setImmediate);
}

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  for (const worker of runningWorkers.splice(0)) {
    if (worker.getState() === "RUNNING") worker.shutdown();
  }
  await Promise.allSettled(workerRuns.splice(0));
  await environment.teardown();
});

describe("realtime workflows", () => {
  test("drops a queued poll whose scheduled start is stale", async () => {
    const worker = await workflowWorker();
    const result = await worker.runUntil(
      environment.client.workflow.execute(scoutRealtimePollWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "stale-realtime-poll",
        args: [
          {
            stage: "dev",
            kind: "prematch",
            scheduledStartAt: "2000-01-01T00:00:00.000Z",
            maximumAgeSeconds: 90,
          },
        ],
      }),
    );
    expect(result).toBe("stale");
  });

  test("durably starts independently identified match children", async () => {
    const ingested: string[] = [];
    const workflow = await workflowWorker();
    const activities = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev-realtime",
      activities: {
        discoverPostMatchIds: () => ({ matchIds: ["NA1_100", "NA1_101"] }),
        ingestMatch: (input: { matchId: string }) => {
          ingested.push(input.matchId);
        },
      },
      maxConcurrentActivityTaskExecutions: 4,
    });
    await startWorker(workflow);
    await startWorker(activities);
    const result = await environment.client.workflow.execute(
      scoutPostMatchDiscoveryWorkflow,
      {
        taskQueue: "scout-dev",
        workflowId: "postmatch-discovery",
        args: [{ stage: "dev" }],
      },
    );
    expect(result).toEqual({ status: "completed", childrenStarted: 2 });
    await expect.poll(() => ingested).toEqual(["NA1_100", "NA1_101"]);
    await expect(
      environment.client.workflow.getHandle("scout-dev-match-NA1_100").result(),
    ).resolves.toBe("completed");
  });
});

test("initial history continues as new with only cursor counters", async () => {
  const observed: {
    cursor?: string;
    pagesProcessed: number;
    pagesInCurrentRun: number;
  }[] = [];
  const workflow = await workflowWorker();
  const activities = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev-background",
    activities: {
      fetchInitialHistoryPage: (input: {
        cursor?: string;
        pagesProcessed: number;
        pagesInCurrentRun: number;
      }) => {
        observed.push(input);
        return observed.length === 1
          ? { nextCursor: "cursor-100", persistedMatches: 10, complete: false }
          : { persistedMatches: 2, complete: true };
      },
    },
    maxConcurrentActivityTaskExecutions: 1,
  });
  await startWorker(workflow);
  await startWorker(activities);
  const result = await environment.client.workflow.execute(
    scoutInitialHistoryWorkflow,
    {
      taskQueue: "scout-dev",
      workflowId: "initial-history-continue",
      args: [
        {
          stage: "dev",
          puuid: "puuid_123",
          pagesProcessed: 99,
          pagesInCurrentRun: 99,
        },
      ],
    },
  );
  expect(result).toEqual({ status: "completed", pagesProcessed: 101 });
  expect(observed).toEqual([
    {
      stage: "dev",
      puuid: "puuid_123",
      pagesProcessed: 99,
      pagesInCurrentRun: 99,
    },
    {
      stage: "dev",
      puuid: "puuid_123",
      cursor: "cursor-100",
      pagesProcessed: 100,
      pagesInCurrentRun: 0,
    },
  ]);
});

test("requestStop cancels the activity and runs non-cancellable cleanup", async () => {
  const started = Promise.withResolvers<undefined>();
  const outcomes: unknown[] = [];
  const workflow = await workflowWorker();
  const activities = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev-interactive",
    activities: {
      runInteractive: async () => {
        started.resolve(undefined);
        const context = Context.current();
        const heartbeat = setInterval(() => context.heartbeat(), 10);
        try {
          await context.cancelled;
        } finally {
          clearInterval(heartbeat);
        }
        return { status: "completed", partialOutputAvailable: false };
      },
      persistInteractiveOutcome: (input: {
        outcome: { status: "cancelled"; partialOutputAvailable: boolean };
      }) => {
        outcomes.push(input);
        return { ...input.outcome, partialOutputAvailable: true };
      },
    },
    maxConcurrentActivityTaskExecutions: 2,
  });
  await startWorker(workflow);
  await startWorker(activities);
  const handle = await environment.client.workflow.start(
    scoutInteractiveRunWorkflow,
    {
      taskQueue: "scout-dev",
      workflowId: "interactive-stop",
      args: [{ stage: "dev", kind: "explore", databaseRunId: "run_123" }],
    },
  );
  await started.promise;
  await handle.signal(requestStopSignal);
  await expect(handle.result()).resolves.toEqual({
    status: "cancelled",
    partialOutputAvailable: true,
  });
  expect(outcomes).toEqual([
    {
      stage: "dev",
      kind: "explore",
      databaseRunId: "run_123",
      outcome: { status: "cancelled", partialOutputAvailable: false },
    },
  ]);
});
