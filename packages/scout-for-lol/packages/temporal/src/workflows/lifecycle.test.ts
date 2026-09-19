import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
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
  scoutPostMatchDiscoveryWorkflow,
  scoutQueueCanaryWorkflow,
  scoutRealtimePollWorkflow,
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

/**
 * A stalled account cursor keeps re-reporting a match whose child already
 * COMPLETED. `ALLOW_DUPLICATE_FAILED_ONLY` refuses to reuse a succeeded ID,
 * so the start is rejected forever. What the run does with that rejection is
 * the difference between ending the stall and hiding it.
 */
async function startRediscoveryWorkers(
  outcome: "reconciled" | "not-ingested",
  observed: {
    attempts: string[];
    reconciled: string[];
    settlement: boolean[];
  },
): Promise<void> {
  const workflow = await workflowWorker();
  const activities = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-dev-realtime",
    activities: {
      discoverPostMatchIds: () => ({
        evidenceComplete: true,
        matches: [
          {
            matchId: "NA1_300",
            sourcePuuid: "puuid-NA1_300",
            region: "AMERICA_NORTH",
            delivery: "live",
          },
        ],
      }),
      ingestMatch: (input: { matchId: string }) => {
        observed.attempts.push(input.matchId);
      },
      reconcileIngestedMatchCursor: (input: { matchId: string }) => {
        observed.reconciled.push(input.matchId);
        return { outcome };
      },
      runPostMatchMaintenance: (input: { settleDareV2Deadlines: boolean }) => {
        observed.settlement.push(input.settleDareV2Deadlines);
      },
    },
    maxConcurrentActivityTaskExecutions: 1,
  });
  await workers.start(workflow);
  await workers.start(activities);
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

  test("ingests independently identified match children in discovery order", async () => {
    const ingested: string[] = [];
    let secondStartedBeforeFirstCompleted = false;
    const workflow = await workflowWorker();
    const activities = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev-realtime",
      activities: {
        discoverPostMatchIds: () => ({
          evidenceComplete: true,
          matches: ["NA1_100", "NA1_101"].map((matchId) => ({
            matchId,
            sourcePuuid: `puuid-${matchId}`,
            region: "AMERICA_NORTH",
            delivery: "live",
          })),
        }),
        ingestMatch: async (input: { matchId: string }) => {
          if (input.matchId === "NA1_100") {
            await new Promise((resolve) => setTimeout(resolve, 50));
          } else if (ingested.length === 0) {
            secondStartedBeforeFirstCompleted = true;
          }
          ingested.push(input.matchId);
        },
        runPostMatchMaintenance: () => {
          return;
        },
      },
      maxConcurrentActivityTaskExecutions: 4,
    });
    await workers.start(workflow);
    await workers.start(activities);
    const result = await environment.client.workflow.execute(
      scoutPostMatchDiscoveryWorkflow,
      {
        taskQueue: "scout-dev",
        workflowId: "postmatch-discovery",
        args: [{ stage: "dev" }],
      },
    );
    expect(result).toEqual({ status: "completed", childrenStarted: 2 });
    expect(ingested).toEqual(["NA1_100", "NA1_101"]);
    expect(secondStartedBeforeFirstCompleted).toBe(false);
    await expect(
      environment.client.workflow.getHandle("scout-dev-match-NA1_100").result(),
    ).resolves.toBe("completed");
  });

  test("propagates Dare evidence completeness and its deadline watermark", async () => {
    const maintenanceInputs: {
      stage: "dev";
      settleDareV2Deadlines: boolean;
      evidenceWatermark?: string;
    }[] = [];
    let discoveryRun = 0;
    const workflow = await workflowWorker();
    const activities = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev-realtime",
      activities: {
        discoverPostMatchIds: () => {
          discoveryRun += 1;
          return discoveryRun === 1
            ? { matches: [], evidenceComplete: false }
            : {
                matches: [],
                evidenceComplete: true,
                evidenceWatermark: "2026-09-01T16:00:00.000Z",
              };
        },
        runPostMatchMaintenance: (input: {
          stage: "dev";
          settleDareV2Deadlines: boolean;
          evidenceWatermark?: string;
        }) => {
          maintenanceInputs.push(input);
        },
      },
      maxConcurrentActivityTaskExecutions: 1,
    });
    await workers.start(workflow);
    await workers.start(activities);

    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-discovery-incomplete",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 0 });
    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-discovery-watermark",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 0 });
    expect(maintenanceInputs).toEqual([
      { stage: "dev", settleDareV2Deadlines: false },
      {
        stage: "dev",
        settleDareV2Deadlines: true,
        evidenceWatermark: "2026-09-01T16:00:00.000Z",
      },
    ]);
  });
});

// Child IDs are one-per-match and permanent, so a rediscovered match always
// collides with whatever execution already owns it. Whether that collision is a
// fault depends entirely on what the owning execution did, which is what these
// cover.
describe("post-match discovery child ownership", () => {
  test("restarts a failed match child without duplicating a successful child", async () => {
    let attempts = 0;
    let failIngestion = true;
    let includeMatchInDiscovery = true;
    const maintenanceDeadlineSettlement: boolean[] = [];
    const workflow = await workflowWorker();
    const activities = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev-realtime",
      activities: {
        discoverPostMatchIds: () => ({
          evidenceComplete: true,
          matches: includeMatchInDiscovery
            ? [
                {
                  matchId: "NA1_200",
                  sourcePuuid: "puuid-NA1_200",
                  region: "AMERICA_NORTH",
                  delivery: "live",
                },
              ]
            : [],
        }),
        ingestMatch: () => {
          attempts += 1;
          if (failIngestion) {
            throw ApplicationFailure.nonRetryable("first execution fails");
          }
        },
        runPostMatchMaintenance: (input: {
          settleDareV2Deadlines: boolean;
        }) => {
          maintenanceDeadlineSettlement.push(input.settleDareV2Deadlines);
        },
      },
      maxConcurrentActivityTaskExecutions: 1,
    });
    await workers.start(workflow);
    await workers.start(activities);

    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-discovery-first-failure",
        args: [{ stage: "dev" }],
      }),
    ).rejects.toThrow();
    expect(maintenanceDeadlineSettlement).toEqual([false]);
    await expect(
      environment.client.workflow.getHandle("scout-dev-match-NA1_200").result(),
    ).rejects.toThrow();

    failIngestion = false;
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
    expect(attempts).toBe(2);

    includeMatchInDiscovery = false;
    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-discovery-after-success",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 0 });
    expect(attempts).toBe(2);
  });

  test("advances the stale cursor when a rediscovered match is confirmed ingested", async () => {
    const observed = { attempts: [], reconciled: [], settlement: [] };
    await startRediscoveryWorkers("reconciled", observed);

    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-rediscovery-first",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 1 });

    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-rediscovery-reconciled",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 0 });

    // Durable progress, not a quiet no-op: the cursor was reconciled rather
    // than the collision merely swallowed.
    expect(observed.reconciled).toEqual(["NA1_300"]);
    // Ingestion ran once, for the child that actually started.
    expect(observed.attempts).toEqual(["NA1_300"]);
    // The match's evidence IS captured, so the second pass may still settle —
    // withholding it here would starve deadlines for a match already ingested.
    expect(observed.settlement).toEqual([true, true]);
  });

  test("stops without settling when a rediscovered match cannot be confirmed", async () => {
    const observed = { attempts: [], reconciled: [], settlement: [] };
    await startRediscoveryWorkers("not-ingested", observed);

    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-rediscovery-unconfirmed-first",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 1 });

    await expect(
      environment.client.workflow.execute(scoutPostMatchDiscoveryWorkflow, {
        taskQueue: "scout-dev",
        workflowId: "postmatch-rediscovery-unconfirmed",
        args: [{ stage: "dev" }],
      }),
    ).resolves.toEqual({ status: "completed", childrenStarted: 0 });

    // Another execution may still be mid-ingest, so nothing advances and the
    // run reports a partial pass instead of settling on unproven evidence.
    expect(observed.reconciled).toEqual(["NA1_300"]);
    expect(observed.attempts).toEqual(["NA1_300"]);
    expect(observed.settlement).toEqual([true, false]);
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
