import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { ScoutParticipantCrawlResult } from "#src/contracts.ts";
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
