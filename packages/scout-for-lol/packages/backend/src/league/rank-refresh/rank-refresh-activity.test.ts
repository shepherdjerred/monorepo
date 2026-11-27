import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ScoutRankRefreshBatchInput } from "@scout-for-lol/temporal/rank-refresh-contracts";
import { testPuuid } from "#src/testing/test-ids.ts";

const enabled = vi.hoisted(() => ({ value: true }));
const refreshDueRanks = vi.hoisted(() => vi.fn());
const fetchCurrentRanks = vi.hoisted(() => vi.fn());

vi.mock("#src/config/dynamic.ts", () => ({
  scoutRankRefreshEnabled: () => enabled.value,
}));
vi.mock("#src/database/index.ts", () => ({ prisma: { tag: "prisma" } }));
vi.mock("#src/league/initial-history/riot.ts", () => ({ fetchCurrentRanks }));
vi.mock("./rank-refresh.ts", () => ({ refreshDueRanks }));

const { runRankRefreshActivity } = await import("./rank-refresh-activity.ts");

const INPUT: ScoutRankRefreshBatchInput = {
  stage: "dev",
  trigger: "schedule",
  excluded: [],
};

beforeEach(() => {
  refreshDueRanks.mockReset();
  enabled.value = true;
});

describe("runRankRefreshActivity", () => {
  test("does nothing, and touches neither the database nor Riot, when the flag is off", async () => {
    enabled.value = false;
    expect(await runRankRefreshActivity(INPUT, vi.fn())).toEqual({
      enabled: false,
      refreshed: 0,
      unranked: 0,
      failed: [],
      more: false,
    });
    expect(refreshDueRanks).not.toHaveBeenCalled();
  });

  test("refreshes one batch through the existing league-entry fetch, skipping the run's excluded players", async () => {
    const rejected = testPuuid("rejected");
    const failed = [{ puuid: testPuuid("other"), status: 403 }];
    refreshDueRanks.mockResolvedValue({
      refreshed: 4,
      unranked: 1,
      failed,
      more: true,
    });
    const progress = vi.fn();

    expect(
      await runRankRefreshActivity(
        { ...INPUT, excluded: [rejected] },
        progress,
      ),
    ).toEqual({ enabled: true, refreshed: 4, unranked: 1, failed, more: true });
    expect(refreshDueRanks).toHaveBeenCalledOnce();
    expect(refreshDueRanks.mock.calls[0]?.[0]).toMatchObject({
      prisma: { tag: "prisma" },
      fetchRanks: fetchCurrentRanks,
      onProgress: progress,
      excluded: [rejected],
    });
  });
});
