import { expect, test } from "vitest";
import {
  RawCurrentGameInfoSchema,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import {
  isLikelyPreStartLobby,
  rosterIsAsCompleteAsItWillGet,
} from "./spectator-roster.ts";

function participant(index: number) {
  return {
    championId: 100 + index,
    puuid: `puuid-${index.toString()}`,
    teamId: index % 2 === 0 ? 100 : 200,
    riotId: `Player${index.toString()}#NA1`,
    spell1Id: 4,
    spell2Id: 14,
    lastSelectedSkinIndex: 0,
    bot: false,
    profileIconId: 1,
  };
}

function game(options: {
  participantCount: number;
  gameLength: number;
  gameMode?: string;
  gameQueueConfigId?: number;
}): RawCurrentGameInfo {
  return RawCurrentGameInfoSchema.parse({
    gameId: 5_647_246_019,
    gameStartTime: 0,
    gameMode: options.gameMode ?? "CLASSIC",
    mapId: 11,
    gameType: "CUSTOM_GAME",
    gameQueueConfigId: options.gameQueueConfigId ?? 0,
    gameLength: options.gameLength,
    platformId: "NA1",
    participants: Array.from({ length: options.participantCount }, (_, index) =>
      participant(index),
    ),
    bannedChampions: [],
  });
}

test("a loading lobby short of ten is still filling", () => {
  const loading = game({ participantCount: 3, gameLength: -42 });
  expect(isLikelyPreStartLobby(loading)).toBe(true);
  expect(rosterIsAsCompleteAsItWillGet(loading)).toBe(false);
});

test("a started game short of ten is the roster, not a filling lobby", () => {
  // The case observed in the field: a custom against nine bots reports one
  // participant because Riot never lists bots, and gameLength climbs while it
  // is deferred on every tick. Nothing is being waited for.
  const botCustom = game({ participantCount: 1, gameLength: 211 });
  expect(isLikelyPreStartLobby(botCustom)).toBe(true);
  expect(rosterIsAsCompleteAsItWillGet(botCustom)).toBe(true);
});

test("the boundary is the moment play starts", () => {
  expect(
    rosterIsAsCompleteAsItWillGet(
      game({ participantCount: 4, gameLength: -1 }),
    ),
  ).toBe(false);
  expect(
    rosterIsAsCompleteAsItWillGet(game({ participantCount: 4, gameLength: 0 })),
  ).toBe(true);
});

test("a full roster is never a pre-start lobby", () => {
  expect(
    isLikelyPreStartLobby(game({ participantCount: 10, gameLength: -30 })),
  ).toBe(false);
});

test("Arena is exempt, because its roster is 16 or 18", () => {
  expect(
    isLikelyPreStartLobby(
      game({
        participantCount: 8,
        gameLength: -20,
        gameMode: "CHERRY",
        gameQueueConfigId: 1700,
      }),
    ),
  ).toBe(false);
});
