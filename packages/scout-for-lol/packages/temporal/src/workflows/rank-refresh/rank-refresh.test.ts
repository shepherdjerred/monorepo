import { expect, test } from "vitest";
import {
  RANK_REFRESH_MAX_BATCHES,
  type ScoutRankRefreshPermanentFailure,
} from "#src/rank-refresh-contracts.ts";
import { useScoutScheduledWorkflowHarness } from "#src/workflows/worker-pool.test-fixtures.ts";

// Needs the Temporal test server: run with the extended tier.
const harness = useScoutScheduledWorkflowHarness("background");
const startBackgroundWorkers = harness.start;

function runRefresh(workflowId: string): Promise<unknown> {
  return harness.run("scoutRankRefreshWorkflow", workflowId);
}

const NONE_FAILED: ScoutRankRefreshPermanentFailure[] = [];

test("a run repeats full batches on the background queue until one comes back short, and totals them", async () => {
  const batches = [
    {
      enabled: true,
      refreshed: 40,
      unranked: 10,
      failed: NONE_FAILED,
      more: true,
    },
    {
      enabled: true,
      refreshed: 20,
      unranked: 5,
      failed: NONE_FAILED,
      more: true,
    },
    {
      enabled: true,
      refreshed: 3,
      unranked: 1,
      failed: NONE_FAILED,
      more: false,
    },
  ];
  let calls = 0;
  await startBackgroundWorkers({
    refreshStaleRanks: (input) => {
      expect(input).toEqual({
        stage: "dev",
        trigger: "schedule",
        excluded: [],
      });
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
      return {
        enabled: true,
        refreshed: 50,
        unranked: 0,
        failed: NONE_FAILED,
        more: true,
      };
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
      return {
        enabled: false,
        refreshed: 0,
        unranked: 0,
        failed: NONE_FAILED,
        more: false,
      };
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

test("a transient batch failure is retried by the background policy, not skipped", async () => {
  let calls = 0;
  await startBackgroundWorkers({
    refreshStaleRanks: () => {
      calls += 1;
      if (calls === 1) throw new Error("Riot API HTTP 500");
      return {
        enabled: true,
        refreshed: 2,
        unranked: 0,
        failed: NONE_FAILED,
        more: false,
      };
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

test("a permanently rejected player is skipped for the rest of the run, the others are refreshed, and the run then fails naming only that player", async () => {
  const rejected = "REJECTED".padEnd(78, "x");
  const inputs: unknown[] = [];
  await startBackgroundWorkers({
    refreshStaleRanks: (input) => {
      inputs.push(input);
      return inputs.length === 1
        ? {
            enabled: true,
            refreshed: 49,
            unranked: 0,
            failed: [{ puuid: rejected, status: 403 }],
            more: true,
          }
        : {
            enabled: true,
            refreshed: 3,
            unranked: 1,
            failed: NONE_FAILED,
            more: false,
          };
    },
  });

  const failure: unknown = await runRefresh(
    "scout-dev-rank-refresh-rejected",
  ).catch((error: unknown) => error);

  expect(inputs).toEqual([
    { stage: "dev", trigger: "schedule", excluded: [] },
    { stage: "dev", trigger: "schedule", excluded: [rejected] },
  ]);
  expect(failure).toMatchObject({
    cause: {
      type: "RankRefreshPermanentFailures",
      nonRetryable: true,
      message: expect.stringMatching(
        /rejected 1 player\(s\).*REJECTED \(HTTP 403\).*\(52 ranked, 1 unranked\)/u,
      ),
    },
  });
  // Only the PUUID's first characters are named, never the whole id.
  expect(failure).toMatchObject({
    cause: { message: expect.not.stringContaining(rejected) },
  });
}, 60_000);
