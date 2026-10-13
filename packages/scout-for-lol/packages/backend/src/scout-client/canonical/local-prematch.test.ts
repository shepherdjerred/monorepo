import { expect, test } from "vitest";
import {
  parseLocalPrematch,
  parseLocalPrematchIdentities,
  enrichPrematch,
} from "./local-prematch.ts";

const observer = "p".repeat(78);
const session = {
  resource: "gameflow_session",
  data: {
    phase: "InProgress",
    gameData: {
      gameId: 123,
      isCustomGame: true,
      queue: { id: 0, mapId: 11, gameMode: "CLASSIC" },
      bannedChampions: [],
      teamOne: [
        {
          puuid: observer,
          championId: 1,
          spell1Id: 4,
          spell2Id: 14,
          selectedSkinIndex: 0,
          profileIconId: 1,
          gameName: "Player",
          tagLine: "NA1",
        },
      ],
      teamTwo: [
        {
          puuid: "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e",
          championId: 2,
          spell1Id: 4,
          spell2Id: 14,
          selectedSkinIndex: 0,
          profileIconId: 1,
        },
      ],
    },
  },
};

test("gameflow roster skins join spells from a unique champion selection", () => {
  const player = session.data.gameData.teamOne[0];
  const opponent = session.data.gameData.teamTwo[0];
  if (player === undefined || opponent === undefined)
    throw new Error("Missing fixture player");
  const native = {
    ...session,
    data: {
      ...session.data,
      gameData: {
        ...session.data.gameData,
        teamOne: [
          {
            puuid: observer,
            championId: 1,
            summonerInternalName: "owner",
            lastSelectedSkinIndex: 2,
            profileIconId: 1,
          },
        ],
        teamTwo: [
          {
            puuid: opponent.puuid,
            championId: 2,
            summonerInternalName: "opponent",
            lastSelectedSkinIndex: 0,
            profileIconId: 1,
          },
        ],
        playerChampionSelections: [
          {
            summonerInternalName: "owner",
            championId: 1,
            selectedSkinIndex: 2,
            spell1Id: 4,
            spell2Id: 14,
          },
          {
            summonerInternalName: "opponent",
            championId: 2,
            selectedSkinIndex: 0,
            spell1Id: 4,
            spell2Id: 7,
          },
        ],
      },
    },
  };
  expect(
    parseLocalPrematch(native, observer, "NA1", "123")?.participants[0],
  ).toMatchObject({ lastSelectedSkinIndex: 2, spell1Id: 4, spell2Id: 14 });
  const ambiguous = {
    ...native,
    data: {
      ...native.data,
      gameData: {
        ...native.data.gameData,
        playerChampionSelections: [
          ...native.data.gameData.playerChampionSelections,
          native.data.gameData.playerChampionSelections[0],
        ],
      },
    },
  };
  expect(parseLocalPrematch(ambiguous, observer, "NA1", "123")).toBeNull();
});

test("a started custom preserves unresolved opponents and refuses wrong identities and champion select", () => {
  const game = parseLocalPrematch(session, observer, "NA1", "123");
  expect(game?.participants.map((player) => player.puuid)).toEqual([
    observer,
    null,
  ]);
  expect(parseLocalPrematch(session, "other", "NA1", "123")).toBeNull();
  expect(parseLocalPrematch(session, observer, "NA1", "124")).toBeNull();
  expect(
    parseLocalPrematch(
      { ...session, data: { ...session.data, phase: "ChampSelect" } },
      observer,
      "NA1",
      "123",
    ),
  ).toBeNull();
  expect(
    parseLocalPrematch(
      {
        ...session,
        data: {
          ...session.data,
          gameData: { ...session.data.gameData, platformId: "EUW1" },
        },
      },
      observer,
      "NA1",
      "123",
    ),
  ).toBeNull();
});

test("Riot facts win while a unique private slot can gain its identity", () => {
  const client = parseLocalPrematch(session, observer, "NA1", "123");
  if (client === null) throw new Error("Fixture must describe a game");
  const riot = {
    ...client,
    gameLength: 50,
    participants: client.participants.map((player) => ({
      ...player,
      puuid: null,
      riotId: "Champion",
    })),
  };
  const enriched = enrichPrematch(riot, client);
  expect(enriched.gameLength).toBe(50);
  expect(enriched.participants[0]?.puuid).toBe(observer);
  expect(enriched.participants[1]?.puuid).toBeNull();
  expect(
    enrichPrematch(riot, {
      ...client,
      participants: [...client.participants, ...client.participants],
    }).participants[0]?.puuid,
  ).toBeNull();
  expect(enrichPrematch(riot, { ...client, gameId: 124 })).toEqual(riot);
});

test("identity-only gameflow can enrich Riot without pretending it can render a whole roster", () => {
  const full = parseLocalPrematch(session, observer, "NA1", "123");
  if (full === null) throw new Error("Fixture must describe a game");
  const partial = {
    ...session,
    data: {
      ...session.data,
      gameData: {
        gameId: 123,
        queue: { id: 0 },
        teamOne: [{ puuid: observer, championId: 1 }],
        teamTwo: [{ puuid: "unknown", championId: 2 }],
      },
    },
  };
  expect(parseLocalPrematch(partial, observer, "NA1", "123")).toBeNull();
  const identities = parseLocalPrematchIdentities(
    partial,
    observer,
    "NA1",
    "123",
  );
  const riot = {
    ...full,
    participants: full.participants.map((player) => ({
      ...player,
      puuid: null,
    })),
  };
  expect(enrichPrematch(riot, identities).participants[0]?.puuid).toBe(
    observer,
  );
  const first = riot.participants[0];
  if (first === undefined) throw new Error("Fixture has no participant");
  const ambiguous = {
    ...riot,
    participants: [...riot.participants, { ...first, spell2Id: 7 }],
  };
  expect(
    enrichPrematch(ambiguous, identities).participants.every(
      (player) => player.puuid === null,
    ),
  ).toBe(true);
});
