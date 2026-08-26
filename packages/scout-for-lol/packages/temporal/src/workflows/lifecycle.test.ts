import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import {
  requestInitialHistoryRunSignal,
  requestStopSignal,
} from "#src/signals.ts";
import {
  scoutInitialHistoryWorkflow,
  scoutIngestionReconciliationWorkflow,
  scoutInteractiveRunWorkflow,
  scoutPostMatchDiscoveryWorkflow,
  scoutQueueCanaryWorkflow,
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

test("routes the queue canary through every workload queue", async () => {
  const workflow = await workflowWorker();
  const queueClasses = [
    "realtime",
    "interactive",
    "background",
    "lake",
  ] as const;
  const activityWorkers = await Promise.all(
    queueClasses.map(
      async (queueClass) =>
        await Worker.create({
          connection: environment.nativeConnection,
          taskQueue: `scout-dev-${queueClass}`,
          activities: {
            probeQueue: (input: {
              stage: "dev";
              canaryId: string;
              queueClass: (typeof queueClasses)[number];
            }) => ({ ...input, taskQueue: Context.current().info.taskQueue }),
          },
          maxConcurrentActivityTaskExecutions: 1,
        }),
    ),
  );
  await startWorker(workflow);
  for (const activityWorker of activityWorkers) {
    await startWorker(activityWorker);
  }
  const result = await environment.client.workflow.execute(
    scoutQueueCanaryWorkflow,
    {
      taskQueue: "scout-dev",
      workflowId: "queue-canary",
      args: [{ stage: "dev", canaryId: "canary_123" }],
    },
  );
  expect(result).toEqual(
    queueClasses.map((queueClass) => ({
      stage: "dev",
      canaryId: "canary_123",
      queueClass,
      taskQueue: `scout-dev-${queueClass}`,
    })),
  );
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
        discoverPostMatchIds: () => ({
          matches: ["NA1_100", "NA1_101"].map((matchId) => ({
            matchId,
            sourcePuuid: `puuid-${matchId}`,
            region: "AMERICA_NORTH",
            delivery: "live",
          })),
        }),
        ingestMatch: (input: { matchId: string }) => {
          ingested.push(input.matchId);
        },
        runPostMatchMaintenance: () => {
          return;
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

  test("restarts a failed match child without duplicating a successful child", async () => {
    let attempts = 0;
    const workflow = await workflowWorker();
    const activities = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev-realtime",
      activities: {
        discoverPostMatchIds: () => ({
          matches: [
            {
              matchId: "NA1_200",
              sourcePuuid: "puuid-NA1_200",
              region: "AMERICA_NORTH",
              delivery: "live",
            },
          ],
        }),
        ingestMatch: () => {
          attempts += 1;
          if (attempts <= 5) throw new Error("first execution fails");
        },
        runPostMatchMaintenance: () => {
          return;
        },
      },
      maxConcurrentActivityTaskExecutions: 1,
    });
    await startWorker(workflow);
    await startWorker(activities);

    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-discovery-first-failure",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 1 });
    await expect(
      environment.client.workflow.getHandle("scout-dev-match-NA1_200").result(),
    ).rejects.toThrow();

    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-discovery-retry",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 1 });
    await expect(
      environment.client.workflow.getHandle("scout-dev-match-NA1_200").result(),
    ).resolves.toBe("completed");
    expect(attempts).toBe(6);

    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-discovery-after-success",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 0 });
    expect(attempts).toBe(6);
  });
});

test("initial history drains incomplete pages across Continue-As-New and accepts a later import signal", async () => {
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
        if (observed.length === 1) {
          return {
            nextCursor: "cursor-100",
            persistedMatches: 10,
            complete: false,
          };
        }
        if (observed.length === 2) {
          return {
            nextCursor: "cursor-101",
            persistedMatches: 10,
            complete: false,
          };
        }
        return { persistedMatches: 2, complete: true };
      },
    },
    maxConcurrentActivityTaskExecutions: 1,
  });
  await startWorker(workflow);
  await startWorker(activities);
  const handle = await environment.client.workflow.start(
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
  await expect.poll(() => observed).toHaveLength(3);
  await handle.signal(requestInitialHistoryRunSignal);
  await expect.poll(() => observed).toHaveLength(4);
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
      runOnStart: true,
    },
    {
      stage: "dev",
      puuid: "puuid_123",
      cursor: "cursor-101",
      pagesProcessed: 101,
      pagesInCurrentRun: 1,
    },
    {
      stage: "dev",
      puuid: "puuid_123",
      pagesProcessed: 102,
      pagesInCurrentRun: 2,
    },
  ]);
  await handle.cancel();
  await expect(handle.result()).rejects.toThrow();
});

test("ingestion reconciliation recovers detached and pending interactive work", async () => {
  const detached: string[] = [];
  const interactive: string[] = [];
  const workflow = await workflowWorker();
  const background = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev-background",
    activities: {
      reconcileIngestion: () => ({
        initialHistoryPuuids: [],
        detachedWorks: [
          { kind: "parlay-generation", workId: "parlay:NA1_300" },
        ],
        interactiveRuns: [
          { kind: "explore", databaseRunId: "interactive_300" },
        ],
      }),
      runDetachedBackgroundWork: (input: { workId: string }) => {
        detached.push(input.workId);
      },
    },
    maxConcurrentActivityTaskExecutions: 1,
  });
  const interactiveWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev-interactive",
    activities: {
      runInteractive: (input: { databaseRunId: string }) => {
        interactive.push(input.databaseRunId);
        return { status: "completed", partialOutputAvailable: false };
      },
      persistInteractiveOutcome: (input: {
        outcome: { status: "completed"; partialOutputAvailable: boolean };
      }) => input.outcome,
    },
    maxConcurrentActivityTaskExecutions: 1,
  });
  await startWorker(workflow);
  await startWorker(background);
  await startWorker(interactiveWorker);

  await expect(
    environment.client.workflow.execute(scoutIngestionReconciliationWorkflow, {
      taskQueue: "scout-dev",
      workflowId: "reconcile-pending-work",
      args: [{ stage: "dev", trigger: "schedule" }],
    }),
  ).resolves.toBe("completed");
  await expect.poll(() => detached).toEqual(["parlay:NA1_300"]);
  await expect.poll(() => interactive).toEqual(["interactive_300"]);
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
