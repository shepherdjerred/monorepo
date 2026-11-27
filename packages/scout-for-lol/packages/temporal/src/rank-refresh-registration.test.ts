import { describe, expect, test } from "vitest";
import {
  RANK_REFRESH_MAX_PERMANENT_FAILURES,
  ScoutRankRefreshBatchInputSchema,
  ScoutRankRefreshBatchResultSchema,
  ScoutRankRefreshInputSchema,
  ScoutRankRefreshResultSchema,
} from "./rank-refresh-contracts.ts";
import { SCOUT_WORKFLOW_NAMES, scoutTaskQueues } from "./identifiers.ts";
import * as workflows from "./workflows/index.ts";

describe("rank refresh contracts", () => {
  test("names a Workflow type the bundle exports", () => {
    expect(SCOUT_WORKFLOW_NAMES.rankRefresh).toBe("scoutRankRefreshWorkflow");
    expect(Object.keys(workflows)).toContain("scoutRankRefreshWorkflow");
  });

  test("its Activity runs on the background queue the other backfills use", () => {
    expect(scoutTaskQueues("beta").background).toBe("scout-beta-background");
    expect(scoutTaskQueues("prod").background).toBe("scout-prod-background");
  });

  test("accepts only the scheduled trigger", () => {
    expect(
      ScoutRankRefreshInputSchema.parse({ stage: "beta", trigger: "schedule" }),
    ).toEqual({ stage: "beta", trigger: "schedule" });
    expect(() =>
      ScoutRankRefreshInputSchema.parse({ stage: "beta", trigger: "manual" }),
    ).toThrow();
    expect(() =>
      ScoutRankRefreshInputSchema.parse({
        stage: "beta",
        trigger: "schedule",
        puuid: "x",
      }),
    ).toThrow();
  });

  test("a batch carries the players already rejected, and at most the run's bound", () => {
    const base = { stage: "beta", trigger: "schedule" };
    expect(
      ScoutRankRefreshBatchInputSchema.parse({ ...base, excluded: [] }),
    ).toEqual({ ...base, excluded: [] });
    expect(() => ScoutRankRefreshBatchInputSchema.parse(base)).toThrow();
    expect(() =>
      ScoutRankRefreshBatchInputSchema.parse({
        ...base,
        excluded: Array.from(
          { length: RANK_REFRESH_MAX_PERMANENT_FAILURES + 1 },
          () => "p".repeat(78),
        ),
      }),
    ).toThrow();
  });

  test("results are closed and non-negative", () => {
    expect(
      ScoutRankRefreshBatchResultSchema.parse({
        enabled: true,
        refreshed: 3,
        unranked: 1,
        failed: [{ puuid: "p".repeat(78), status: 403 }],
        more: false,
      }),
    ).toEqual({
      enabled: true,
      refreshed: 3,
      unranked: 1,
      failed: [{ puuid: "p".repeat(78), status: 403 }],
      more: false,
    });
    expect(() =>
      ScoutRankRefreshBatchResultSchema.parse({
        enabled: true,
        refreshed: -1,
        unranked: 0,
        failed: [],
        more: false,
      }),
    ).toThrow();
    expect(() =>
      ScoutRankRefreshResultSchema.parse({
        enabled: true,
        batches: 0,
        refreshed: 0,
        unranked: 0,
        drained: true,
      }),
    ).toThrow();
  });
});
