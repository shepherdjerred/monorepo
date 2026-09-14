import { describe, expect, test } from "vitest";
import type { RawCurrentGameInfo } from "@scout-for-lol/data";
import { isPrematchRosterComplete } from "#src/temporal/v2/prematch/prematch-context.ts";

function gameWith(overrides: {
  participants: number;
  gameQueueConfigId?: number;
  gameMode?: string;
}): RawCurrentGameInfo {
  return {
    gameId: 9101,
    gameStartTime: 0,
    gameMode: overrides.gameMode ?? "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: overrides.gameQueueConfigId ?? 420,
    gameLength: -20,
    platformId: "NA1",
    participants: Array.from({ length: overrides.participants }, () => ({
      puuid: "p".repeat(78),
      teamId: 100,
      spell1Id: 4,
      spell2Id: 14,
      championId: 1,
      profileIconId: 1,
      riotId: "player#NA1",
      bot: false,
      lastSelectedSkinIndex: 0,
      gameCustomizationObjects: [],
      perks: { perkIds: [], perkStyle: 0, perkSubStyle: 0 },
    })),
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
