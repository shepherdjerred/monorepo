import { describe, expect, test } from "vitest";
import type { RawCurrentGameInfo } from "@scout-for-lol/data";
import { isPrematchRosterComplete } from "#src/temporal/v2/prematch/prematch-context.ts";

function gameWith(overrides: {
  participants: number;
  gameQueueConfigId?: number;
  gameMode?: string;
  gameType?: string;
  gameLength?: number;
}): RawCurrentGameInfo {
  return {
    gameId: 9101,
    gameStartTime: 0,
    gameMode: overrides.gameMode ?? "CLASSIC",
    mapId: 11,
    gameType: overrides.gameType ?? "MATCHED_GAME",
    gameQueueConfigId: overrides.gameQueueConfigId ?? 420,
    gameLength: overrides.gameLength ?? -20,
    platformId: "NA1",
    participants: Array.from(
      { length: overrides.participants },
      (_, index) => ({
        puuid: "p".repeat(78),
        teamId: index % 2 === 0 ? 100 : 200,
        spell1Id: 4,
        spell2Id: 14,
        championId: 1,
        profileIconId: 1,
        riotId: "player#NA1",
        bot: false,
        lastSelectedSkinIndex: 0,
        gameCustomizationObjects: [],
        perks: { perkIds: [], perkStyle: 0, perkSubStyle: 0 },
      }),
    ),
    bannedChampions: [],
  };
}

describe("isPrematchRosterComplete", () => {
  test("defers a lobby that has not finished loading in", () => {
    // Riot surfaces a game during its pre-game countdown with only the players
    // who have loaded. Capturing it would claim the per-game Workflow ID with
    // a snapshot missing tracked players, and every later poll would be
    // deduplicated against that.
    expect(isPrematchRosterComplete(gameWith({ participants: 4 }))).toBe(false);
  });

  test("takes a started 2v2 custom, whose roster is four by design", () => {
    // Both pipelines must agree, so V2 uses v1's started-custom rule.
    expect(
      isPrematchRosterComplete(
        gameWith({
          participants: 4,
          gameType: "CUSTOM_GAME",
          gameQueueConfigId: 0,
          gameLength: 45,
        }),
      ),
    ).toBe(true);
  });

  test("still defers a 2v2 custom while it is loading", () => {
    expect(
      isPrematchRosterComplete(
        gameWith({
          participants: 4,
          gameType: "CUSTOM_GAME",
          gameQueueConfigId: 0,
          gameLength: -10,
        }),
      ),
    ).toBe(false);
  });

  test("takes a full ten-player roster", () => {
    expect(isPrematchRosterComplete(gameWith({ participants: 10 }))).toBe(true);
  });

  test("takes an Arena lobby, whose roster is never ten", () => {
    // Arena is 16 or 18 players and has its own schema. Measuring it against
    // ten would defer every Arena game forever, so it would never be
    // announced at all.
    expect(
      isPrematchRosterComplete(
        gameWith({
          participants: 16,
          gameQueueConfigId: 1700,
          gameMode: "CHERRY",
        }),
      ),
    ).toBe(true);
  });
});
