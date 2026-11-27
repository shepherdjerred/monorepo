import { expect, test } from "vitest";
import { RANK_REFRESH_MAX_BATCHES } from "#src/rank-refresh-contracts.ts";
import { useScoutScheduledWorkflowHarness } from "#src/workflows/worker-pool.test-fixtures.ts";

// Needs the Temporal test server: run with the extended tier.
const harness = useScoutScheduledWorkflowHarness("background");
const startBackgroundWorkers = harness.start;

function runRefresh(workflowId: string): Promise<unknown> {
  return harness.run("scoutRankRefreshWorkflow", workflowId);
}

test("a run repeats full batches on the background queue until one comes back short, and totals them", async () => {
  const batches = [
    { enabled: true, refreshed: 40, unranked: 10, more: true },
    { enabled: true, refreshed: 20, unranked: 5, more: true },
    { enabled: true, refreshed: 3, unranked: 1, more: false },
  ];
  let calls = 0;
  await startBackgroundWorkers({
    refreshStaleRanks: (input) => {
      expect(input).toEqual({ stage: "dev", trigger: "schedule" });
      const batch = batches[calls];
      calls += 1;
      if (batch === undefined) throw new Error("no batch");
      return batch;
    },
  });

  expect(await runRefresh("scout-dev-rank-refresh-test")).toEqual({
    enabled: true,
    batches: 3,
    refreshed: 63,
    unranked: 16,
    drained: true,
  });
  expect(calls).toBe(3);
}, 60_000);

test("a run stops at its batch limit and reports it is not drained", async () => {
  let calls = 0;
  await startBackgroundWorkers({
    refreshStaleRanks: () => {
      calls += 1;
      return { enabled: true, refreshed: 50, unranked: 0, more: true };
    },
  });

  expect(await runRefresh("scout-dev-rank-refresh-limit")).toEqual({
    enabled: true,
    batches: RANK_REFRESH_MAX_BATCHES,
    refreshed: 50 * RANK_REFRESH_MAX_BATCHES,
    unranked: 0,
    drained: false,
  });
  expect(calls).toBe(RANK_REFRESH_MAX_BATCHES);
}, 60_000);

test("a disabled kill switch ends the run after one no-op batch", async () => {
  let calls = 0;
  await startBackgroundWorkers({
    refreshStaleRanks: () => {
      calls += 1;
      return { enabled: false, refreshed: 0, unranked: 0, more: false };
    },
  });

  expect(await runRefresh("scout-dev-rank-refresh-disabled")).toEqual({
    enabled: false,
    batches: 1,
    refreshed: 0,
    unranked: 0,
    drained: true,
  });
  expect(calls).toBe(1);
}, 60_000);

test("a failed batch is retried by the background policy, not skipped", async () => {
  let calls = 0;
  await startBackgroundWorkers({
    refreshStaleRanks: () => {
      calls += 1;
      if (calls === 1) throw new Error("Riot API HTTP 500");
      return { enabled: true, refreshed: 2, unranked: 0, more: false };
    },
  });

  expect(await runRefresh("scout-dev-rank-refresh-retry")).toEqual({
    enabled: true,
    batches: 1,
    refreshed: 2,
    unranked: 0,
    drained: true,
  });
  expect(calls).toBe(2);
}, 60_000);
