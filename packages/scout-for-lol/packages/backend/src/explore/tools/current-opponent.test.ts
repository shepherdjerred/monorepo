import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { describe, expect, test } from "vitest";
import {
  RawCurrentGameInfoSchema,
  type RawCurrentGameParticipant,
} from "@scout-for-lol/data";
import { findCurrentLaneOpponentInGame } from "#src/explore/tools/current-opponent.ts";

const REQUESTER_PUUID = "r".repeat(78);
const OPPONENT_PUUID = "o".repeat(78);

function participant(input: {
  championId: number;
  puuid: RawCurrentGameParticipant["puuid"];
  riotId: string;
  teamId: number;
  spell1Id: number;
  spell2Id: number;
}): RawCurrentGameParticipant {
  return {
    ...input,
    lastSelectedSkinIndex: 0,
    bot: false,
    profileIconId: 1,
  };
}

function standardGame(opposingTopPuuid: string | null) {
  return RawCurrentGameInfoSchema.parse({
    gameId: 1,
    gameStartTime: 1,
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: 120,
    platformId: "NA1",
    bannedChampions: [],
    participants: [
      participant({
        championId: 150,
        puuid: LeaguePuuidSchema.parse(REQUESTER_PUUID),
        riotId: "Me#NA1",
        teamId: 100,
        spell1Id: 4,
        spell2Id: 12,
      }),
      participant({
        championId: 104,
        puuid: LeaguePuuidSchema.parse(
          "ally-jungle0000000000000000000000000000000000000000000000000000000000000000000",
        ),
        riotId: "Jungle#NA1",
        teamId: 100,
        spell1Id: 4,
        spell2Id: 11,
      }),
      participant({
        championId: 112,
        puuid: LeaguePuuidSchema.parse(
          "ally-mid0000000000000000000000000000000000000000000000000000000000000000000000",
        ),
        riotId: "Mid#NA1",
        teamId: 100,
        spell1Id: 12,
        spell2Id: 4,
      }),
      participant({
        championId: 81,
        puuid: LeaguePuuidSchema.parse(
          "ally-adc0000000000000000000000000000000000000000000000000000000000000000000000",
        ),
        riotId: "Adc#NA1",
        teamId: 100,
        spell1Id: 21,
        spell2Id: 4,
      }),
      participant({
        championId: 37,
        puuid: LeaguePuuidSchema.parse(
          "ally-support000000000000000000000000000000000000000000000000000000000000000000",
        ),
        riotId: "Support#NA1",
        teamId: 100,
        spell1Id: 7,
        spell2Id: 4,
      }),
      participant({
        championId: 122,
        puuid: opposingTopPuuid,
        riotId: opposingTopPuuid === null ? "Darius" : "Opponent#NA1",
        teamId: 200,
        spell1Id: 4,
        spell2Id: 12,
      }),
      participant({
        championId: 64,
        puuid: LeaguePuuidSchema.parse(
          "enemy-jungle000000000000000000000000000000000000000000000000000000000000000000",
        ),
        riotId: "EnemyJungle#NA1",
        teamId: 200,
        spell1Id: 4,
        spell2Id: 11,
      }),
      participant({
        championId: 103,
        puuid: LeaguePuuidSchema.parse(
          "enemy-mid000000000000000000000000000000000000000000000000000000000000000000000",
        ),
        riotId: "EnemyMid#NA1",
        teamId: 200,
        spell1Id: 12,
        spell2Id: 4,
      }),
      participant({
        championId: 222,
        puuid: LeaguePuuidSchema.parse(
          "enemy-adc000000000000000000000000000000000000000000000000000000000000000000000",
        ),
        riotId: "EnemyAdc#NA1",
        teamId: 200,
        spell1Id: 21,
        spell2Id: 4,
      }),
      participant({
        championId: 117,
        puuid: LeaguePuuidSchema.parse(
          "enemy-support00000000000000000000000000000000000000000000000000000000000000000",
        ),
        riotId: "EnemySupport#NA1",
        teamId: 200,
        spell1Id: 7,
        spell2Id: 4,
      }),
    ],
  });
}

describe("current lane opponent", () => {
  test("pairs the requester with the opposing inferred laner", () => {
    expect(
      findCurrentLaneOpponentInGame(
        {
          puuid: LeaguePuuidSchema.parse(REQUESTER_PUUID),
          region: "AMERICA_NORTH",
        },
        standardGame(OPPONENT_PUUID),
      ),
    ).toEqual({
      kind: "found",
      puuid: OPPONENT_PUUID,
      riotId: "Opponent#NA1",
      region: "AMERICA_NORTH",
      lane: "top",
    });
  });

  test("refuses a privacy-scrubbed opposing identity", () => {
    expect(
      findCurrentLaneOpponentInGame(
        {
          puuid: LeaguePuuidSchema.parse(REQUESTER_PUUID),
          region: "AMERICA_NORTH",
        },
        standardGame(null),
      ),
    ).toEqual({
      kind: "unavailable",
      message: "Riot hid the opposing laner's identity in this lobby.",
    });
  });

  test("refuses a matchup supported only by participant ordering", () => {
    const game = standardGame(OPPONENT_PUUID);
    const ambiguous = RawCurrentGameInfoSchema.parse({
      ...game,
      participants: game.participants.map((entry, index) => ({
        ...entry,
        championId: 99_900 + index,
        spell1Id: 1,
        spell2Id: 2,
      })),
    });

    expect(
      findCurrentLaneOpponentInGame(
        {
          puuid: LeaguePuuidSchema.parse(REQUESTER_PUUID),
          region: "AMERICA_NORTH",
        },
        ambiguous,
      ),
    ).toEqual({
      kind: "unavailable",
      message: "Scout could not infer a reliable lane matchup from this lobby.",
    });
  });
});
