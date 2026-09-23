import { afterEach, describe, expect, test, vi } from "vitest";
import {
  LeaguePuuidSchema,
  PlayerConfigEntrySchema,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { ScoutPrematchGameRefSchema } from "@scout-for-lol/temporal/contracts-v2";

/**
 * What the V2 capture concludes from each of the spectator boundary's three
 * outcomes.
 *
 * This is the distinction the boundary now draws, tested where it matters: the
 * capture's conclusion is DURABLE, because its game-scoped Workflow ID is
 * consumed by a completed run. A confirmed absence must end the run, and an
 * unanswered read must not be allowed to look like one.
 */

const PUUID = LeaguePuuidSchema.parse("p".repeat(78));

const mocks = vi.hoisted(() => ({
  getActiveGame: vi.fn(),
  getAccountsWithState: vi.fn(),
}));

vi.mock("#src/league/api/spectator.ts", () => ({
  getActiveGame: mocks.getActiveGame,
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: {},
  getAccountsWithState: mocks.getAccountsWithState,
}));
const { resolveScoutV2PrematchContext } =
  await import("#src/temporal/v2/prematch/prematch-context.ts");

const GAME_REF = ScoutPrematchGameRefSchema.parse({
  puuid: PUUID,
  platform: "NA1",
  gameId: "9101",
});

function trackedAccount() {
  return {
    config: PlayerConfigEntrySchema.parse({
      alias: "tracked",
      league: { leagueAccount: { puuid: PUUID, region: "AMERICA_NORTH" } },
    }),
    lastMatchTime: new Date(),
    lastCheckedAt: undefined,
  };
}

function fullRoster(): RawCurrentGameInfo {
  return {
    gameId: 9101,
    gameStartTime: 0,
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: 12,
    platformId: "NA1",
    bannedChampions: [],
    participants: Array.from({ length: 10 }, (_unused, index) => ({
      puuid: index === 0 ? PUUID : `other-${index.toString()}`,
      teamId: index < 5 ? 100 : 200,
      spell1Id: 4,
      spell2Id: 14,
      championId: index + 1,
      profileIconId: 1,
      riotId: `player-${index.toString()}#NA1`,
      bot: false,
      lastSelectedSkinIndex: 0,
      gameCustomizationObjects: [],
      perks: { perkIds: [], perkStyle: 0, perkSubStyle: 0 },
    })),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the V2 capture's spectator read", () => {
  test("treats a confirmed 404 as the game being over", async () => {
    mocks.getAccountsWithState.mockResolvedValue([trackedAccount()]);
    mocks.getActiveGame.mockResolvedValue({ kind: "not-in-game" });

    // Riot looked and there is no game. Nothing to capture, and no retry could
    // find one — the only outcome that may end the run as a no-op.
    await expect(resolveScoutV2PrematchContext(GAME_REF)).resolves.toBeNull();
  });

  test.each([
    {
      name: "a payload that failed validation",
      reason: "payload-failed-validation",
      upstream: false,
    },
    { name: "an unreachable endpoint", reason: "unreachable", upstream: false },
    { name: "a rate limit", reason: "http-429", upstream: false },
    { name: "an upstream outage", reason: "upstream-503", upstream: true },
  ])("refuses to call $name an absent game", async ({ reason, upstream }) => {
    mocks.getAccountsWithState.mockResolvedValue([trackedAccount()]);
    mocks.getActiveGame.mockResolvedValue({
      kind: "unavailable",
      upstream,
      reason,
    });

    // Returning null for any of these would let the Workflow complete as a
    // no-op, and its completed game-scoped ID would then refuse every later
    // poll — one transient blip costing the snapshot permanently. Throwing
    // hands the wait to the Activity's retry policy instead.
    await expect(resolveScoutV2PrematchContext(GAME_REF)).rejects.toThrow(
      new RegExp(reason),
    );
  });

  test("a later attempt succeeds once the endpoint answers", async () => {
    mocks.getAccountsWithState.mockResolvedValue([trackedAccount()]);
    mocks.getActiveGame
      .mockResolvedValueOnce({
        kind: "unavailable",
        upstream: false,
        reason: "unreachable",
      })
      .mockResolvedValueOnce({ kind: "in-game", game: fullRoster() });

    await expect(resolveScoutV2PrematchContext(GAME_REF)).rejects.toThrow();

    // The retry is the wait loop: the throw above cost nothing durable, so the
    // attempt that follows captures the game it was always going to capture.
    const resumed = await resolveScoutV2PrematchContext(GAME_REF);
    expect(resumed?.riotMatchId).toBe("NA1_9101");
    expect(resumed?.trackedPlayers.map((player) => player.alias)).toEqual([
      "tracked",
    ]);
  });
});
