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

vi.mock("#src/database/index.ts", () => database);
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

// Spy on Sentry.captureException so the test can assert on the reported
// message. Spread the real module so the mock stays process-global safe.
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

const PUUID_A = "11111111-1111-4111-8111-111111111111";
const PUUID_B = "22222222-2222-4222-8222-222222222222";

function accountFor(puuid: string): MatchPollAccount {
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

beforeEach(() => {
  vi.clearAllMocks();
  database.getLastProcessedMatch.mockResolvedValue(null);
  matchHistoryApi.getRecentMatchIds.mockResolvedValue(undefined);
});

describe("collectNewMatches unavailable-history reporting", () => {
  test("reports the same message for different players so Bugsink groups them", async () => {
    const currentTime = new Date("2026-09-23T00:00:00.000Z");
    await collectNewMatches({
      playersToCheck: [accountFor(PUUID_A), accountFor(PUUID_B)],
      currentTime,
      requiredDarePuuids: new Set(),
    });

    expect(captureException).toHaveBeenCalledTimes(2);
    const messages: string[] = [];
    for (const [error, options] of captureException.mock.calls) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) {
        throw new Error("expected the captured value to be an Error");
      }
      messages.push(error.message);
      expect(error.message).not.toContain(PUUID_A);
      expect(error.message).not.toContain(PUUID_B);
      expect(options?.tags?.["puuid"]).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(messages).toEqual([
      "Match history is unavailable",
      "Match history is unavailable",
    ]);
  });

  test("still fails the collection when a Dare-required player is unavailable", async () => {
    const currentTime = new Date("2026-09-23T00:00:00.000Z");
    const result = await collectNewMatches({
      playersToCheck: [accountFor(PUUID_A)],
      currentTime,
      requiredDarePuuids: new Set([PUUID_A]),
    });

    expect(result).toEqual({ complete: false, playersWithMatches: [] });
  });
});
