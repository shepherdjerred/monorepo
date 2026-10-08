import { afterEach, beforeEach, expect, test } from "vitest";
import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, type WorkerOptions } from "@temporalio/worker";
import {
  requestInitialHistoryRunSignal,
  requestStopSignal,
} from "#src/signals.ts";
import {
  scoutInitialHistoryWorkflow,
  scoutExploreHistoryWorkflow,
  scoutExploreTimelineWorkflow,
  scoutIngestionReconciliationWorkflow,
  scoutInteractiveRunWorkflow,
  scoutQueueCanaryWorkflow,
} from "./index.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

let environment: TestWorkflowEnvironment;
const workers = createScoutWorkerPool();

function workflowWorker(): Promise<Worker> {
  return Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev",
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
    maxConcurrentWorkflowTaskExecutions: 4,
  });
}

async function startExploreAcquisitionWorkers(
  phases: string[],
  activities: NonNullable<WorkerOptions["activities"]>,
): Promise<void> {
  const workflow = await workflowWorker();
  const background = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev-background",
    activities,
  });
  const lake = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev-lake",
    activities: {
      runReportLakeJob: () => {
        phases.push("fold");
      },
    },
  });
  await workers.start(workflow);
  await workers.start(background);
  await workers.start(lake);
}

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await workers.drain();
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
  await workers.start(workflow);
  for (const activityWorker of activityWorkers) {
    await workers.start(activityWorker);
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

test("imports Explore history before folding the report lake", async () => {
  const phases: string[] = [];
  await startExploreAcquisitionWorkers(phases, {
    importExploreHistory: () => {
      phases.push("import");
      return {
        requested: 100,
        found: 87,
        alreadyAvailable: 50,
        ingested: 36,
        skipped: 1,
      };
    },
  });

  const result = await environment.client.workflow.execute(
    scoutExploreHistoryWorkflow,
    {
      taskQueue: "scout-dev",
      workflowId: "explore-history",
      args: [
        {
          stage: "dev",
          puuid: "puuid_123",
          region: "AMERICA_NORTH",
          acquisitionBucket: 123,
          requestedMatches: 100,
        },
      ],
    },
  );

  expect(result).toEqual({
    requested: 100,
    found: 87,
    alreadyAvailable: 50,
    ingested: 36,
    skipped: 1,
  });
  expect(phases).toEqual(["import", "fold"]);
});

test("imports Explore timelines before folding the report lake", async () => {
  const phases: string[] = [];
  await startExploreAcquisitionWorkers(phases, {
    importExploreTimelines: () => {
      phases.push("import");
      return {
        requested: 3,
        alreadyAvailable: 1,
        ingested: 2,
        unavailable: 0,
      };
    },
  });

  const result = await environment.client.workflow.execute(
    scoutExploreTimelineWorkflow,
    {
      taskQueue: "scout-dev",
      workflowId: "explore-timeline",
      args: [
        {
          stage: "dev",
          matchIds: ["NA1_1", "NA1_2", "NA1_3"],
          acquisitionBucket: 123,
        },
      ],
    },
  );

  expect(result).toEqual({
    requested: 3,
    alreadyAvailable: 1,
    ingested: 2,
    unavailable: 0,
  });
  expect(phases).toEqual(["import", "fold"]);
});

test("initial history drains incomplete pages across Continue-As-New and accepts a later import signal", async () => {
  const observed: {
    cursor?: string;
    pagesProcessed: number;
    pagesInCurrentRun: number;
  }[] = [];
  let releaseFinalPage!: () => void;
  const finalPageMayComplete = new Promise<void>((resolve) => {
    releaseFinalPage = resolve;
  });
  const workflow = await workflowWorker();
  const activities = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev-background",
    activities: {
      fetchInitialHistoryPage: async (input: {
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
        if (observed.length === 3) await finalPageMayComplete;
        return { persistedMatches: 2, complete: true };
      },
    },
    maxConcurrentActivityTaskExecutions: 1,
  });
  await workers.start(workflow);
  await workers.start(activities);
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
  await expect.poll(() => observed, { timeout: 10_000 }).toHaveLength(3);
  try {
    await handle.signal(requestInitialHistoryRunSignal);
  } finally {
    releaseFinalPage();
  }
  await expect.poll(() => observed, { timeout: 10_000 }).toHaveLength(4);
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
  await workers.start(workflow);
  await workers.start(background);
  await workers.start(interactiveWorker);

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

test(
  "requestStop cancels the activity and runs non-cancellable cleanup",
  { timeout: 15_000 },
  async () => {
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
    await workers.start(workflow);
    await workers.start(activities);
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
  },
);
