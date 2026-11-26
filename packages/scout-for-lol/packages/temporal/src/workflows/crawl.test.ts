import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import {
  CRAWL_FRONTIER_PRUNE_MAX_BATCHES,
  type ScoutCrawlFrontierPruneBatchResult,
  type ScoutParticipantCrawlResult,
} from "#src/contracts.ts";
import { scoutTaskQueues } from "#src/identifiers.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

// Needs the Temporal test server: run with the extended tier.
let environment: TestWorkflowEnvironment;
const workers = createScoutWorkerPool();
const queues = scoutTaskQueues("dev");

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await workers.drain();
  await environment.teardown();
});

const result: ScoutParticipantCrawlResult = {
  status: "completed",
  seededObservations: 0,
  admittedPlayers: 0,
  playersVisited: 1,
  matchesStored: 2,
  segmentsWritten: 1,
};

/** Start the workflow worker and a crawl-queue worker running `runParticipantCrawl`. */
async function startWorkers(
  runParticipantCrawl: (input: unknown) => ScoutParticipantCrawlResult,
): Promise<void> {
  await workers.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: queues.workflow,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    }),
  );
  await workers.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: queues.crawl,
      activities: { runParticipantCrawl },
    }),
  );
}

function runTick(workflowId: string): Promise<unknown> {
  return environment.client.workflow.execute("scoutParticipantCrawlWorkflow", {
    workflowId,
    taskQueue: queues.workflow,
    args: [{ stage: "dev", trigger: "schedule" }],
  });
}

test("one tick runs one crawl Activity on the crawl queue and returns its counts", async () => {
  const inputs: unknown[] = [];
  await startWorkers((input) => {
    inputs.push(input);
    return result;
  });

  expect(await runTick("scout-dev-participant-crawl-test")).toEqual(result);
  expect(inputs).toEqual([{ stage: "dev", trigger: "schedule" }]);
}, 60_000);

test("a failed tick is not retried: the next scheduled tick is the retry", async () => {
  let attempts = 0;
  await startWorkers(() => {
    attempts += 1;
    throw new Error("database unavailable");
  });

  await expect(
    runTick("scout-dev-participant-crawl-failure"),
  ).rejects.toThrow();
  expect(attempts).toBe(1);
}, 60_000);

/** Start the workflow worker and a crawl-queue worker running `pruneCrawlFrontier`. */
async function startPruneWorkers(
  pruneCrawlFrontier: (input: unknown) => ScoutCrawlFrontierPruneBatchResult,
): Promise<void> {
  await workers.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: queues.workflow,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    }),
  );
  await workers.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: queues.crawl,
      activities: { pruneCrawlFrontier },
    }),
  );
}

function runPrune(workflowId: string): Promise<unknown> {
  return environment.client.workflow.execute(
    "scoutCrawlFrontierPruneWorkflow",
    {
      workflowId,
      taskQueue: queues.workflow,
      args: [{ stage: "dev", trigger: "schedule" }],
    },
  );
}

test("a prune run repeats full batches until one comes back short, and totals them", async () => {
  const batches = [
    { stale: 2000, overflow: 0, more: true },
    { stale: 500, overflow: 1500, more: true },
    { stale: 0, overflow: 40, more: false },
  ];
  let calls = 0;
  await startPruneWorkers((input) => {
    expect(input).toEqual({ stage: "dev", trigger: "schedule" });
    const batch = batches[Math.min(calls, batches.length - 1)];
    calls += 1;
    if (batch === undefined) throw new Error("no batch");
    return batch;
  });

  expect(await runPrune("scout-dev-crawl-frontier-prune-test")).toEqual({
    batches: 3,
    stale: 2500,
    overflow: 1540,
    drained: true,
  });
  expect(calls).toBe(3);
}, 60_000);

test("a prune run stops at its batch limit and reports the frontier is not drained", async () => {
  let calls = 0;
  await startPruneWorkers(() => {
    calls += 1;
    return { stale: 2000, overflow: 0, more: true };
  });

  expect(await runPrune("scout-dev-crawl-frontier-prune-limit")).toEqual({
    batches: CRAWL_FRONTIER_PRUNE_MAX_BATCHES,
    stale: 2000 * CRAWL_FRONTIER_PRUNE_MAX_BATCHES,
    overflow: 0,
    drained: false,
  });
  expect(calls).toBe(CRAWL_FRONTIER_PRUNE_MAX_BATCHES);
}, 60_000);
