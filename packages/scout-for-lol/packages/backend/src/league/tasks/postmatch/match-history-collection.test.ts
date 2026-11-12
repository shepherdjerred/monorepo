import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as RealSentry from "@sentry/bun";
import { LeaguePuuidSchema, type PlayerConfigEntry } from "@scout-for-lol/data";
import type { MatchPollAccount } from "#src/league/tasks/postmatch/match-discovery-selection.ts";

const database = vi.hoisted(() => ({
  getLastProcessedMatch: vi.fn(),
  updateLastCheckedAt: vi.fn(),
}));

const matchHistoryApi = vi.hoisted(() => ({
  getRecentMatchIds: vi.fn(),
}));

vi.mock("#src/database/account-cursors.ts", () => database);
vi.mock("#src/league/api/match-history.ts", () => ({
  getRecentMatchIds: matchHistoryApi.getRecentMatchIds,
  filterNewMatches: vi.fn(),
}));
vi.mock("#src/league/tasks/postmatch/gap-recovery.ts", () => ({
  recoverMissedMatches: vi.fn(),
}));
vi.mock("#src/league/tasks/postmatch/match-discovery-selection.ts", () => ({
  matchHistoryReadCount: () => 5,
}));
vi.mock("#src/utils/polling-intervals.ts", () => ({
  calculatePollingInterval: () => 5,
}));

// Spy on Sentry.captureException so the test can assert on what is reported.
// Spread the real module so the mock stays process-global safe.
const captureException = vi.fn(
  (_error: unknown, _options?: { tags?: Record<string, string> }): undefined =>
    undefined,
);

await vi.doMock("@sentry/bun", () => ({
  ...RealSentry,
  captureException,
}));

const { collectNewMatches } =
  await import("#src/league/tasks/postmatch/match-history-collection.ts");
const { scoutMatchHistoryUnavailableTotal } =
  await import("#src/metrics/match-history.ts");

const PUUID_A = "11111111-1111-4111-8111-111111111111";
const PUUID_B = "22222222-2222-4222-8222-222222222222";
const currentTime = new Date("2026-09-23T00:00:00.000Z");

function accountFor(puuid: LeaguePuuid): MatchPollAccount {
  const player: PlayerConfigEntry = {
    alias: `player-${puuid.slice(0, 8)}`,
    league: {
      leagueAccount: {
        puuid: LeaguePuuidSchema.parse(puuid),
        region: "AMERICA_NORTH",
      },
    },
  };
  return { config: player, lastMatchTime: undefined, lastCheckedAt: undefined };
}

async function unavailableCount(dareRequired: "true" | "false") {
  const emitted = await scoutMatchHistoryUnavailableTotal.get();
  return (
    emitted.values.find(
      (series) => series.labels.dare_required === dareRequired,
    )?.value ?? 0
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  scoutMatchHistoryUnavailableTotal.reset();
  database.getLastProcessedMatch.mockResolvedValue(null);
  matchHistoryApi.getRecentMatchIds.mockResolvedValue(undefined);
});

describe("collectNewMatches unavailable history", () => {
  test("counts unavailable history without reporting it and leaves players unchecked", async () => {
    const result = await collectNewMatches({
      playersToCheck: [
        accountFor(LeaguePuuidSchema.parse(PUUID_A)),
        accountFor(LeaguePuuidSchema.parse(PUUID_B)),
      ],
      currentTime,
      requiredDarePuuids: new Set(),
    });

    expect(result).toEqual({ complete: true, playersWithMatches: [] });
    expect(matchHistoryApi.getRecentMatchIds).toHaveBeenCalledTimes(2);
    expect(captureException).not.toHaveBeenCalled();
    expect(database.updateLastCheckedAt).not.toHaveBeenCalled();
    expect(await unavailableCount("false")).toBe(2);
  });

  test("still fails the collection when a Dare-required player is unavailable", async () => {
    const result = await collectNewMatches({
      playersToCheck: [accountFor(LeaguePuuidSchema.parse(PUUID_A))],
      currentTime,
      requiredDarePuuids: new Set([PUUID_A]),
    });

    expect(result).toEqual({ complete: false, playersWithMatches: [] });
    expect(captureException).not.toHaveBeenCalled();
    expect(await unavailableCount("true")).toBe(1);
  });

  test("still reports an unexpected failure with the player's tags", async () => {
    matchHistoryApi.getRecentMatchIds.mockRejectedValue(
      new Error("cursor store is unreachable"),
    );

    const result = await collectNewMatches({
      playersToCheck: [accountFor(LeaguePuuidSchema.parse(PUUID_A))],
      currentTime,
      requiredDarePuuids: new Set([PUUID_A]),
    });

    expect(result).toEqual({ complete: false, playersWithMatches: [] });
    expect(captureException).toHaveBeenCalledOnce();
    const [error, options] = captureException.mock.calls[0] ?? [];
    expect(error).toEqual(new Error("cursor store is unreachable"));
    expect(options?.tags).toMatchObject({
      source: "match-history-check",
      puuid: PUUID_A,
    });
    expect(await unavailableCount("true")).toBe(0);
  });
});
