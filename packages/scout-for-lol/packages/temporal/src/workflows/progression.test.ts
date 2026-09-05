import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { duelSeriesChangedSignal } from "#src/signals.ts";
import {
  scoutChallengeRunRecomputeWorkflow,
  scoutDuelSeriesWorkflow,
  scoutHallBaselineWorkflow,
} from "./index.ts";

let environment: TestWorkflowEnvironment;
const runningWorkers: Worker[] = [];
const workerRuns: Promise<void>[] = [];

async function startWorker(worker: Worker): Promise<void> {
  runningWorkers.push(worker);
  workerRuns.push(worker.run());
  while (worker.getState() === "INITIALIZED") await new Promise(setImmediate);
}

async function startWorkflowWorker(): Promise<void> {
  await startWorker(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev",
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      maxConcurrentWorkflowTaskExecutions: 4,
    }),
  );
}

async function startActivityWorker(
  taskQueue: "scout-dev-background" | "scout-dev-lake",
  activities: Record<string, (...args: never[]) => unknown>,
): Promise<void> {
  await startWorker(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue,
      activities,
      maxConcurrentActivityTaskExecutions: 2,
    }),
  );
}

async function createProgressionEnvironment(): Promise<void> {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}

async function destroyProgressionEnvironment(): Promise<void> {
  for (const worker of runningWorkers.splice(0)) {
    if (worker.getState() === "RUNNING") worker.shutdown();
  }
  await Promise.allSettled(workerRuns.splice(0));
  await environment.teardown();
}

beforeEach(createProgressionEnvironment, 60_000);
afterEach(destroyProgressionEnvironment);

test("retries a Hall baseline activity without duplicating workflow state", async () => {
  let attempts = 0;
  await startWorkflowWorker();
  await startActivityWorker("scout-dev-lake", {
    runHallBaseline: () => {
      attempts++;
      if (attempts === 1) throw new Error("retry the baseline page");
    },
  });

  await expect(
    environment.client.workflow.execute(scoutHallBaselineWorkflow, {
      taskQueue: "scout-dev",
      workflowId: "progression-hall-retry",
      args: [{ stage: "dev", guildId: "guild_1", revision: 1 }],
    }),
  ).resolves.toBe("completed");
  expect(attempts).toBe(2);
});

test("pages a challenge recomputation with its stable evidence cursor", async () => {
  const observed: unknown[] = [];
  await startWorkflowWorker();
  await startActivityWorker("scout-dev-lake", {
    recomputeChallengeRunPage: (input: unknown) => {
      observed.push(input);
      if (observed.length === 1) {
        return {
          complete: false,
          nextCursor: {
            gameEndMs: 100,
            matchId: "NA1_1",
            puuid: "puuid_1",
          },
          evaluatedMatches: 1,
        };
      }
      return { complete: true, evaluatedMatches: 2 };
    },
  });

  await expect(
    environment.client.workflow.execute(scoutChallengeRunRecomputeWorkflow, {
      taskQueue: "scout-dev",
      workflowId: "progression-challenge-pages",
      args: [
        {
          stage: "dev",
          runId: "00000000-0000-4000-8000-000000000001",
          revision: 2,
          pagesProcessed: 0,
        },
      ],
    }),
  ).resolves.toBe("completed");
  expect(observed).toEqual([
    {
      stage: "dev",
      runId: "00000000-0000-4000-8000-000000000001",
      revision: 2,
      pagesProcessed: 0,
    },
    {
      stage: "dev",
      runId: "00000000-0000-4000-8000-000000000001",
      revision: 2,
      pagesProcessed: 1,
      cursor: { gameEndMs: 100, matchId: "NA1_1", puuid: "puuid_1" },
    },
  ]);
});

test(
  "deduplicates duel change signals by request id",
  { timeout: 15_000 },
  async () => {
    const firstRefresh = Promise.withResolvers<undefined>();
    const secondRefresh = Promise.withResolvers<undefined>();
    let refreshes = 0;
    const deadlineAt = new Date(Date.now() + 86_400_000).toISOString();
    await startWorkflowWorker();
    await startActivityWorker("scout-dev-background", {
      refreshDuelSeries: () => {
        refreshes++;
        if (refreshes === 1) firstRefresh.resolve(undefined);
        if (refreshes === 2) secondRefresh.resolve(undefined);
        return {
          terminal: refreshes >= 3,
          status: refreshes >= 3 ? "completed" : "awaiting_readiness",
          deadlineAt,
        };
      },
    });

    const handle = await environment.client.workflow.start(
      scoutDuelSeriesWorkflow,
      {
        taskQueue: "scout-dev",
        workflowId: "progression-duel-signals",
        args: [
          {
            stage: "dev",
            seriesId: "00000000-0000-4000-8000-000000000002",
            deadlineAt,
          },
        ],
      },
    );
    await firstRefresh.promise;
    await handle.signal(duelSeriesChangedSignal, { requestId: "ready_1" });
    await secondRefresh.promise;
    await handle.signal(duelSeriesChangedSignal, { requestId: "ready_1" });
    await environment.sleep("1 minute");
    expect(refreshes).toBe(2);
    await handle.signal(duelSeriesChangedSignal, { requestId: "ready_2" });
    await expect(handle.result()).resolves.toBe("completed");
    expect(refreshes).toBe(3);
  },
);

test("time-skips a duel deadline and marks it overdue without a winner", async () => {
  const overdueInputs: unknown[] = [];
  const deadlineAt = new Date(Date.now() + 3_600_000).toISOString();
  await startWorkflowWorker();
  await startActivityWorker("scout-dev-background", {
    refreshDuelSeries: () => ({
      terminal: false,
      status: "scheduled",
      deadlineAt,
    }),
    markDuelSeriesOverdue: (input: unknown) => {
      overdueInputs.push(input);
    },
  });

  await expect(
    environment.client.workflow.execute(scoutDuelSeriesWorkflow, {
      taskQueue: "scout-dev",
      workflowId: "progression-duel-overdue",
      args: [
        {
          stage: "dev",
          seriesId: "00000000-0000-4000-8000-000000000003",
          deadlineAt,
        },
      ],
    }),
  ).resolves.toBe("completed");
  expect(overdueInputs).toEqual([
    {
      stage: "dev",
      seriesId: "00000000-0000-4000-8000-000000000003",
      deadlineAt,
    },
  ]);
});
