import { beforeEach, describe, expect, test, vi } from "vitest";

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

beforeEach(() => {
  refreshDueRanks.mockReset();
  enabled.value = true;
});

describe("runRankRefreshActivity", () => {
  test("does nothing, and touches neither the database nor Riot, when the flag is off", async () => {
    enabled.value = false;
    expect(await runRankRefreshActivity(vi.fn())).toEqual({
      enabled: false,
      refreshed: 0,
      unranked: 0,
      more: false,
    });
    expect(refreshDueRanks).not.toHaveBeenCalled();
  });

  test("refreshes one batch through the existing league-entry fetch when the flag is on", async () => {
    refreshDueRanks.mockResolvedValue({
      refreshed: 4,
      unranked: 1,
      more: true,
    });
    const progress = vi.fn();

    expect(await runRankRefreshActivity(progress)).toEqual({
      enabled: true,
      refreshed: 4,
      unranked: 1,
      more: true,
    });
    expect(refreshDueRanks).toHaveBeenCalledOnce();
    expect(refreshDueRanks.mock.calls[0]?.[0]).toMatchObject({
      prisma: { tag: "prisma" },
      fetchRanks: fetchCurrentRanks,
      onProgress: progress,
    });
  });
});
