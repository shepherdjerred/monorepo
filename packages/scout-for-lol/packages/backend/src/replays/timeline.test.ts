import { RawMatchSchema, type RawTimeline } from "@scout-for-lol/data";
import { expect, test } from "vitest";
import type { StoredPublicReplay } from "./catalog.ts";
import { projectPublicReplayTimeline } from "./timeline.ts";

const match = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);
const matchId = match.metadata.matchId;
const replay: StoredPublicReplay = {
  id: "58001d3b-f679-4bb6-9b3d-314900818b27",
  platformId: match.info.platformId,
  gameId: String(match.info.gameId),
  digest: "a".repeat(64),
  objectKey: "private-replay-key",
  bytes: 100n,
  gameBuild: match.info.gameVersion,
  protocol: "20e09df23c66b85e",
  durationSeconds: match.info.gameDuration,
  mapId: 11,
  gameMode: "CLASSIC",
  teamSizes: [5, 5],
};
const timeline: RawTimeline = {
  metadata: match.metadata,
  info: {
    gameId: match.info.gameId,
    participants: match.info.participants.map(({ participantId, puuid }) => ({
      participantId,
      puuid,
    })),
    frameInterval: 60_000,
    frames: [
      {
        timestamp: 60_000,
        participantFrames: null,
        events: [
          { timestamp: 25_000, type: "CHAT", text: "private message" },
          {
            timestamp: 25_000,
            type: "CHAMPION_KILL",
            killerId: 1,
            victimId: 8,
            position: { x: 117, y: 916 },
          },
          {
            timestamp: 30_000,
            type: "ELITE_MONSTER_KILL",
            killerTeamId: 100,
            monsterSubType: "private text misfiled as an objective",
            monsterType: "DRAGON",
          },
          {
            timestamp: 30_000,
            type: "BUILDING_KILL",
            teamId: 200,
            towerType: "OUTER_TURRET",
          },
        ],
      },
    ],
  },
};

test("projects only allowlisted events, public fields and explicitly attributed teams", () => {
  expect(projectPublicReplayTimeline(replay, matchId, match, timeline)).toEqual(
    {
      source: "riot_match_timeline",
      events: [
        {
          id: 0,
          timestampMs: 25_000,
          type: "CHAMPION_KILL",
          objective: null,
          teamId: null,
        },
        {
          id: 1,
          timestampMs: 30_000,
          type: "ELITE_MONSTER_KILL",
          objective: "DRAGON",
          teamId: 100,
        },
        {
          id: 2,
          timestampMs: 30_000,
          type: "BUILDING_KILL",
          objective: "OUTER_TURRET",
          teamId: null,
        },
      ],
    },
  );
});

test("requires matching Riot result and timeline evidence for a public queue", () => {
  const otherGame = { ...timeline, info: { ...timeline.info, gameId: 1 } };
  const otherRoster = {
    ...timeline,
    info: {
      ...timeline.info,
      participants: timeline.info.participants.map((player) => ({
        ...player,
        puuid: "different",
      })),
    },
  };
  const client = {
    ...timeline,
    metadata: { ...timeline.metadata, dataVersion: "local-1" },
  };
  const custom = {
    ...match,
    info: { ...match.info, queueId: 0, gameType: "CUSTOM_GAME" },
  };
  const clash = { ...match, info: { ...match.info, queueId: 700 } };
  expect(
    projectPublicReplayTimeline(replay, matchId, match, otherGame),
  ).toBeNull();
  expect(
    projectPublicReplayTimeline(replay, matchId, match, otherRoster),
  ).toBeNull();
  expect(
    projectPublicReplayTimeline(replay, matchId, match, client),
  ).toBeNull();
  expect(
    projectPublicReplayTimeline(replay, matchId, custom, timeline),
  ).toBeNull();
  expect(
    projectPublicReplayTimeline(replay, matchId, clash, timeline),
  ).toBeNull();
  expect(
    projectPublicReplayTimeline(
      { ...replay, gameBuild: "99.0.0.0" },
      matchId,
      match,
      timeline,
    ),
  ).toBeNull();
  expect(
    projectPublicReplayTimeline(
      { ...replay, durationSeconds: match.info.gameDuration + 6 },
      matchId,
      match,
      timeline,
    ),
  ).toBeNull();
});

test.each([
  [0, true],
  [-1, false],
  [match.info.gameDuration * 1000 + 5000, true],
  [match.info.gameDuration * 1000 + 5001, false],
])("checks event clock boundary %d", (timestamp, expected) => {
  const dated: RawTimeline = {
    ...timeline,
    info: {
      ...timeline.info,
      frames: [
        {
          timestamp,
          participantFrames: null,
          events: [{ timestamp, type: "GAME_END", winningTeam: 200 }],
        },
      ],
    },
  };
  const projected = projectPublicReplayTimeline(replay, matchId, match, dated);
  if (expected) {
    expect(projected?.events).toEqual([
      {
        id: 0,
        timestampMs: timestamp,
        type: "GAME_END",
        objective: null,
        teamId: 200,
      },
    ]);
  } else {
    expect(projected).toBeNull();
  }
});
