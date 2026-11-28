import { expect, test } from "vitest";
import {
  CRAWL_FRONTIER_PRUNE_MAX_BATCHES,
  type ScoutParticipantCrawlResult,
} from "#src/contracts.ts";
import { useScoutScheduledWorkflowHarness } from "./worker-pool.test-fixtures.ts";

// Needs the Temporal test server: run with the extended tier.
const harness = useScoutScheduledWorkflowHarness("crawl");

const result: ScoutParticipantCrawlResult = {
  status: "completed",
  seededObservations: 0,
  admittedPlayers: 0,
  playersVisited: 1,
  matchesStored: 2,
  segmentsWritten: 1,
};

const startWorkers = harness.start;

function runTick(workflowId: string): Promise<unknown> {
  return harness.run("scoutParticipantCrawlWorkflow", workflowId);
}

test("one tick runs one crawl Activity on the crawl queue and returns its counts", async () => {
  const inputs: unknown[] = [];
  await startWorkers({
    runParticipantCrawl: (input) => {
      inputs.push(input);
      return result;
    },
  });

  expect(await runTick("scout-dev-participant-crawl-test")).toEqual(result);
  expect(inputs).toEqual([{ stage: "dev", trigger: "schedule" }]);
}, 60_000);

test("a failed tick is not retried: the next scheduled tick is the retry", async () => {
  let attempts = 0;
  await startWorkers({
    runParticipantCrawl: () => {
      attempts += 1;
      throw new Error("database unavailable");
    },
  });

  await expect(
    runTick("scout-dev-participant-crawl-failure"),
  ).rejects.toThrow();
  expect(attempts).toBe(1);
}, 60_000);

function runPrune(workflowId: string): Promise<unknown> {
  return harness.run("scoutCrawlFrontierPruneWorkflow", workflowId);
}

test("a prune run repeats full batches until one comes back short, and totals them", async () => {
  const batches = [
    { stale: 2000, overflow: 0, more: true },
    { stale: 500, overflow: 1500, more: true },
    { stale: 0, overflow: 40, more: false },
  ];
  let calls = 0;
  await startWorkers({
    pruneCrawlFrontier: (input) => {
      expect(input).toEqual({ stage: "dev", trigger: "schedule" });
      const batch = batches[Math.min(calls, batches.length - 1)];
      calls += 1;
      if (batch === undefined) throw new Error("no batch");
      return batch;
    },
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
  await startWorkers({
    pruneCrawlFrontier: () => {
      calls += 1;
      return { stale: 2000, overflow: 0, more: true };
    },
  });

  expect(await runPrune("scout-dev-crawl-frontier-prune-limit")).toEqual({
    batches: CRAWL_FRONTIER_PRUNE_MAX_BATCHES,
    stale: 2000 * CRAWL_FRONTIER_PRUNE_MAX_BATCHES,
    overflow: 0,
    drained: false,
  });
  expect(calls).toBe(CRAWL_FRONTIER_PRUNE_MAX_BATCHES);
}, 60_000);
