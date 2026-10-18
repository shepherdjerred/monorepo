import { expect, test } from "vitest";
import { GameResultSchema, resolveGameResult } from "./game-result.ts";

const client = GameResultSchema.parse({
  matchId: "NA1_123",
  source: "SCOUT_CLIENT",
  sourceId: "local",
  queueId: 700,
  gameMode: "CLASSIC",
  gameType: "MATCHED_GAME",
  gameCreation: 1_700_000_000_000,
  durationSeconds: 1200,
  participants: [true, false].map((win, index) => ({
    participantId: index + 1,
    teamId: (index + 1) * 100,
    identity: { kind: "riot", puuid: String(index).repeat(78) },
    championId: 1,
    name: null,
    win,
    kills: 9,
    deaths: 0,
    assists: null,
    gold: null,
    damageToChampions: null,
    minions: null,
    level: null,
  })),
});

test("Riot wins overlap, including zero; compatible local statistics enrich absence", () => {
  const riot = GameResultSchema.parse({
    ...client,
    source: "RIOT",
    sourceId: "riot",
    participants: client.participants.map((player) => ({
      ...player,
      kills: 0,
      deaths: null,
    })),
  });
  const result = resolveGameResult([client, riot]);
  expect(result?.source).toBe("RIOT");
  expect(result?.participants[0]).toMatchObject({
    kills: 0,
    deaths: 0,
    assists: null,
  });
  expect(resolveGameResult([riot, client])).toEqual(result);
  expect(resolveGameResult([riot], client)).toBe(client);
});

test("a different identity or game cannot enrich a participant number", () => {
  const other = GameResultSchema.parse({
    ...client,
    sourceId: "a",
    participants: client.participants.map((player) => ({
      ...player,
      identity: { kind: "unresolved" },
      kills: null,
    })),
  });
  expect(resolveGameResult([other, client])?.participants[0]?.kills).toBeNull();
  expect(resolveGameResult([])).toBeNull();
  expect(
    GameResultSchema.safeParse({
      ...client,
      participants: [client.participants[0], client.participants[0]],
    }).success,
  ).toBe(false);
});

test("equal-authority outcome conflicts stay unresolved and Riot can resolve them", () => {
  const contradicted = GameResultSchema.parse({
    ...client,
    sourceId: "contradiction",
    participants: client.participants.map((player) => ({
      ...player,
      win: !player.win,
    })),
  });
  expect(resolveGameResult([client, contradicted])).toBeNull();
  const riot = GameResultSchema.parse({
    ...client,
    source: "RIOT",
    sourceId: "riot",
  });
  expect(resolveGameResult([client, contradicted, riot])?.source).toBe("RIOT");
});

test("contradictory known identities stay unresolved until Riot resolves them", () => {
  const contradicted = GameResultSchema.parse({
    ...client,
    sourceId: "other-observer",
    participants: client.participants.map((player) => ({
      ...player,
      identity: { kind: "riot", puuid: "x".repeat(78) },
    })),
  });
  expect(resolveGameResult([client, contradicted])).toBeNull();
  const riot = GameResultSchema.parse({ ...client, source: "RIOT" });
  expect(resolveGameResult([contradicted, riot])).toEqual(riot);
});

test("contradictory game metadata cannot supply missing Riot statistics", () => {
  const riot = GameResultSchema.parse({
    ...client,
    source: "RIOT",
    participants: client.participants.map((player) => ({
      ...player,
      deaths: null,
    })),
  });
  const contradicted = GameResultSchema.parse({ ...client, gameMode: "ARAM" });
  expect(
    resolveGameResult([contradicted, riot])?.participants[0]?.deaths,
  ).toBeNull();
});

test("scoreboards can omit unknown participant numbers and lobby creation while retaining observed completion", () => {
  const scoreboard = GameResultSchema.parse({
    ...client,
    gameCreation: null,
    completedAt: 1_700_001_200_000,
    participants: client.participants.map((player) => ({
      ...player,
      participantId: null,
      items: [1, 2, 3, 4, 5, 6, 0],
      spells: [4, 14],
      jungleMinions: 0,
    })),
  });
  expect(scoreboard.gameCreation).toBeNull();
  expect(
    GameResultSchema.safeParse({ ...scoreboard, completedAt: undefined })
      .success,
  ).toBe(false);
  const riot = GameResultSchema.parse({ ...client, source: "RIOT" });
  const result = resolveGameResult([scoreboard, riot]);
  expect(result?.source).toBe("RIOT");
  expect(result?.participants[0]).toMatchObject({
    participantId: 1,
    items: [1, 2, 3, 4, 5, 6, 0],
    jungleMinions: 0,
  });
});

test("known participant-number contradictions remain conflicts", () => {
  const changed = GameResultSchema.parse({
    ...client,
    sourceId: "changed",
    participants: client.participants.map((player, index) => ({
      ...player,
      participantId: index + 10,
    })),
  });
  expect(resolveGameResult([client, changed])).toBeNull();
});
