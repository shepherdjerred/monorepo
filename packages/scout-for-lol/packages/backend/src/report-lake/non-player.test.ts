import {
  RawMatchSchema,
  RawTimelineSchema,
  SCOUT_CLIENT_DATA_VERSION,
  type RawCurrentGameInfo,
  type RawMatch,
} from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import { flattenMatch, flattenPrematch } from "#src/report-lake/flatten.ts";
import { flattenTimeline } from "#src/report-lake/flatten-timeline.ts";
import { LakeNonPlayerParticipantError } from "#src/report-lake/non-player.ts";
import { lcuParticipantIdentity } from "#src/scout-client/canonical/lcu-identity.ts";

const LCU_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

const riot = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

/** The Riot fixture as a client would build it with a bot and an unaliased player. */
function scoutBuiltWithNonPlayers(match: RawMatch): RawMatch {
  const participants = match.info.participants.map((participant, index) =>
    index === 0
      ? { ...participant, puuid: null, participantKind: "bot" as const }
      : index === 1
        ? {
            ...participant,
            puuid: null,
            participantKind: "unresolved" as const,
            leagueClientUuid: LCU_UUID,
          }
        : { ...participant, participantKind: "player" as const },
  );
  return RawMatchSchema.parse({
    metadata: {
      ...match.metadata,
      dataVersion: SCOUT_CLIENT_DATA_VERSION,
      participants: participants.flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
    },
    info: { ...match.info, participants },
  });
}

describe("report lake participant boundary", () => {
  test("a match naming a bot or an unresolved player is refused, loudly", () => {
    const match = scoutBuiltWithNonPlayers(riot);

    expect(() => flattenMatch(match)).toThrow(LakeNonPlayerParticipantError);
    expect(() => flattenMatch(match)).toThrow(/participants 1, 2/u);
  });

  test("a timeline naming non-players is refused the same way", () => {
    const timeline = RawTimelineSchema.parse({
      metadata: {
        dataVersion: SCOUT_CLIENT_DATA_VERSION,
        matchId: riot.metadata.matchId,
        participants: ["p".repeat(78)],
      },
      info: {
        frameInterval: 60_000,
        gameId: riot.info.gameId,
        participants: [
          {
            participantId: 1,
            puuid: "p".repeat(78),
            participantKind: "player",
          },
          { participantId: 2, puuid: null, participantKind: "bot" },
          {
            participantId: 3,
            puuid: null,
            participantKind: "unresolved",
            leagueClientUuid: LCU_UUID,
          },
        ],
        frames: [{ timestamp: 0, participantFrames: null, events: [] }],
      },
    });

    expect(() => flattenTimeline(timeline, new Date(0))).toThrow(
      LakeNonPlayerParticipantError,
    );
  });

  test("a Riot match still flattens one row per player", () => {
    expect(flattenMatch(riot)).toHaveLength(riot.info.participants.length);
  });
});

describe("hidden players stay hidden", () => {
  const hidden = {
    championId: 266,
    puuid: null,
    teamId: 200,
    // Riot's stand-in for a privacy-scrubbed Riot ID: the champion's name.
    riotId: "Aatrox",
    spell1Id: 4,
    spell2Id: 7,
    lastSelectedSkinIndex: 0,
    bot: false,
    profileIconId: 1,
  };
  const gameInfo: RawCurrentGameInfo = {
    gameId: 123,
    gameStartTime: 0,
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: -30,
    platformId: "NA1",
    participants: [
      {
        ...hidden,
        championId: 1,
        puuid: "p".repeat(78),
        teamId: 100,
        riotId: "Player#NA1",
      },
      hidden,
      { ...hidden, championId: 2, riotId: "Bot", bot: true },
    ],
    bannedChampions: [],
  };

  test("a null-PUUID non-bot Spectator participant produces no lake row", () => {
    const rows = flattenPrematch(gameInfo, new Date("2026-07-01T12:00:00Z"));

    expect(rows.map((row) => row.puuid)).toEqual(["p".repeat(78)]);
    expect(JSON.stringify(rows)).not.toContain("Aatrox");
  });

  test("a League-client entry with no identity never becomes one", () => {
    // Neither a player nor a bot nor an unaliased UUID: nobody to name.
    expect(lcuParticipantIdentity("", false)).toBeNull();
    expect(lcuParticipantIdentity("", undefined)).toBeNull();
    expect(lcuParticipantIdentity("hidden", false)).toBeNull();
    expect(lcuParticipantIdentity(LCU_UUID, true)).toBeNull();
  });
});
