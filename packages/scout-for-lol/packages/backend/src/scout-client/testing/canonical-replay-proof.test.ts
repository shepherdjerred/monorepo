import { LeaguePuuidSchema } from "@scout-for-lol/data";
import { expect, test } from "vitest";
import path from "node:path";
import {
  canonicalReplayMatchId,
  canonicalReplayRequests,
  matchCanonicalReplayFooter,
  readCanonicalReplayEnvelope,
  selectCanonicalReplayOwner,
} from "./canonical-replay-proof.ts";

const identity = { puuid: LeaguePuuidSchema.parse("a".repeat(78)) };
const request = { gameId: "123", queueId: 420, gameBuild: "16.23.841.8428" };
const participants = Array.from({ length: 10 }, (_, index) => ({
  puuid: index === 0 ? identity.puuid : "b".repeat(78),
  participantId: index + 1,
  championName: "SameChampion",
  riotIdGameName: `Fixture ${index.toString()}`,
  riotIdTagline: "TEST",
  teamId: index < 5 ? 100 : 200,
  kills: 1,
  deaths: 2,
  assists: 3,
}));
const match = {
  metadata: { matchId: canonicalReplayMatchId(request.gameId) },
  info: {
    gameId: 123,
    queueId: request.queueId,
    gameVersion: request.gameBuild,
    gameMode: "CLASSIC",
    mapId: 11,
    participants,
  },
};

test("routes two canonical matches independently for the same paired account", () => {
  const second = { ...request, gameId: "124", queueId: 490 };
  const config = {
    matchPath: undefined,
    matchDirectory: "private-canonical-input",
    ownerPuuid: identity.puuid,
    legacyOwnerChampion: undefined,
  };
  const entries = canonicalReplayRequests([request, second], config);
  expect(entries.map(({ matchPath }) => path.basename(matchPath))).toEqual([
    "NA1_123.json",
    "NA1_124.json",
  ]);
  const secondMatch = {
    metadata: { matchId: canonicalReplayMatchId(second.gameId) },
    info: {
      ...match.info,
      gameId: 124,
      queueId: second.queueId,
      participants: participants.map((participant) => ({
        ...participant,
        championName: "AnotherChampion",
      })),
    },
  };
  const matches = [match, secondMatch];
  expect(
    entries.map(({ game, owner }, index) => {
      const payload = matches[index];
      if (payload === undefined) throw new Error("Missing synthetic match");
      return selectCanonicalReplayOwner(payload, game, owner).championName;
    }),
  ).toEqual(["SameChampion", "AnotherChampion"]);
  expect(() => selectCanonicalReplayOwner(match, second, identity)).toThrow(
    "differs from the requested replay identity",
  );
  expect(() =>
    canonicalReplayRequests([request, second], {
      ...config,
      ownerPuuid: undefined,
    }),
  ).toThrow();
  expect(() =>
    canonicalReplayRequests([request], { ...config, matchPath: "other.json" }),
  ).toThrow("Choose only one");
});

test("selects the explicit account even when champion names repeat", () => {
  expect(selectCanonicalReplayOwner(match, request, identity)).toEqual(
    participants[0],
  );
  expect(() =>
    selectCanonicalReplayOwner(match, request, { champion: "SameChampion" }),
  ).toThrow("requires a unique owner");
  expect(() =>
    selectCanonicalReplayOwner(match, request, {
      puuid: LeaguePuuidSchema.parse("c".repeat(78)),
    }),
  ).toThrow("requires a unique owner");
});

test("rejects substituted canonical match identity, incorrect map, and unsafe inputs", () => {
  expect(() => canonicalReplayMatchId("../123")).toThrow();
  expect(() =>
    selectCanonicalReplayOwner(match, { ...request, gameId: "124" }, identity),
  ).toThrow("differs from the requested replay identity");
  expect(() =>
    selectCanonicalReplayOwner(
      match,
      { ...request, gameBuild: "16.23.841.8429" },
      identity,
    ),
  ).toThrow("differs from the requested replay identity");
  expect(() =>
    selectCanonicalReplayOwner(
      { ...match, info: { ...match.info, mapId: 12 } },
      request,
      identity,
    ),
  ).toThrow("complete Map11 CLASSIC 5v5 roster");
});

test("requires a unique independent Riot identity and participant-stat join", () => {
  const owner = selectCanonicalReplayOwner(match, request, identity);
  const row = {
    PUUID: "10000000-0000-4000-8000-000000000001",
    RIOT_ID_GAME_NAME: owner.riotIdGameName,
    RIOT_ID_TAG_LINE: owner.riotIdTagline,
    SKIN: owner.championName,
    TEAM: "100",
    CHAMPIONS_KILLED: "1",
    NUM_DEATHS: "2",
    ASSISTS: "3",
  };
  expect(matchCanonicalReplayFooter([row], owner).lcuUuid).toBe(row.PUUID);
  expect(() => matchCanonicalReplayFooter([row, row], owner)).toThrow(
    "uniquely joined",
  );
  expect(() =>
    matchCanonicalReplayFooter([{ ...row, ASSISTS: "4" }], owner),
  ).toThrow("uniquely joined");
});

test("requires a supported binary header and a bounded footer", () => {
  const build = request.gameBuild;
  const header = Buffer.alloc(15);
  header.write("RIOT");
  header.writeUInt16LE(2, 4);
  Buffer.from("8bbfcd5af2bc92db", "hex").copy(header, 6);
  header[14] = build.length;
  const footer = Buffer.from(JSON.stringify({ statsJson: "[]" }));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(footer.length);
  const bytes = Buffer.concat([
    header,
    Buffer.from(build),
    Buffer.alloc(256),
    footer,
    size,
  ]);
  expect(readCanonicalReplayEnvelope(bytes)).toEqual({
    gameBuild: build,
    stats: [],
  });
  expect(() => readCanonicalReplayEnvelope(bytes.subarray(0, 20))).toThrow(
    "Invalid replay proof header",
  );
  const unsupported = Buffer.from(bytes);
  unsupported[6] = 0;
  expect(() => readCanonicalReplayEnvelope(unsupported)).toThrow();
});
