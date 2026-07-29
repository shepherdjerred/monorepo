import { describe, expect, test } from "bun:test";
import {
  PlayerConfigEntrySchema,
  RawMatchSchema,
  type RawMatch,
} from "@scout-for-lol/data";
import { buildClassicMatch } from "./match-report-classic.ts";

const fixtureUrl = new URL(
  "../../../../../../testdata/rift.json",
  import.meta.url,
);

async function classicMatchFixture(): Promise<RawMatch> {
  const input: unknown = await Bun.file(fixtureUrl).json();
  const base = RawMatchSchema.parse(input);
  const classicChampionIds = [
    60_103, 60_012, 60_032, 60_034, 60_001, 60_022, 60_053, 60_063, 60_031,
    60_042,
  ];
  return RawMatchSchema.parse({
    ...base,
    info: {
      ...base.info,
      queueId: 4310,
      gameMode: "JADE",
      mapId: 453,
      participants: base.info.participants.map((participant, index) => ({
        ...participant,
        championId: classicChampionIds[index],
        championName: "Classic",
        riotIdGameName: `Classic Player ${(index + 1).toString()}`,
        riotIdTagline: `J${(index + 1).toString().padStart(2, "0")}`,
        summoner1Id: 74,
        summoner2Id: 714,
        item0: 771_001,
        item1: 771_004,
        item2: 771_006,
        item3: 771_011,
        item4: 771_018,
        item5: 771_026,
        item6: 0,
      })),
    },
  });
}

describe("buildClassicMatch", () => {
  test("groups full rosters by team ID and keeps the narrow Classic model", async () => {
    const rawMatch = await classicMatchFixture();
    const trackedParticipant = rawMatch.info.participants[6];
    if (trackedParticipant === undefined) {
      throw new Error("Classic fixture is missing its tracked participant");
    }
    const trackedPlayer = PlayerConfigEntrySchema.parse({
      alias: "Scout Classic",
      league: {
        leagueAccount: {
          puuid: trackedParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });

    const result = buildClassicMatch(rawMatch, [trackedPlayer]);

    expect(result.queueType).toBe("classic");
    expect(result.mapName).toBe("Classic Rift");
    expect(result.teams.blue).toHaveLength(5);
    expect(result.teams.red).toHaveLength(5);
    expect(result.players[0]?.team).toBe("red");
    expect(result.players[0]?.champion.puuid).toBe(trackedParticipant.puuid);
    expect(result.teams.red[1]?.championName).toBe("Jade_Blitzcrank");
    expect(result.teams.red[1]?.spells).toEqual([74, 714]);
    expect("runes" in (result.teams.red[1] ?? {})).toBe(false);
    expect("rankBeforeMatch" in (result.players[0] ?? {})).toBe(false);
  });

  test("preserves partial custom-team sizes instead of slicing", async () => {
    const rawMatch = await classicMatchFixture();
    const partial = RawMatchSchema.parse({
      ...rawMatch,
      metadata: {
        ...rawMatch.metadata,
        participants: rawMatch.metadata.participants.slice(0, 5),
      },
      info: {
        ...rawMatch.info,
        participants: [
          ...rawMatch.info.participants.slice(0, 3),
          ...rawMatch.info.participants.slice(5, 7),
        ],
      },
    });
    const trackedParticipant = partial.info.participants[0];
    if (trackedParticipant === undefined) {
      throw new Error("Partial Classic fixture has no participants");
    }
    const trackedPlayer = PlayerConfigEntrySchema.parse({
      alias: "Partial Classic",
      league: {
        leagueAccount: {
          puuid: trackedParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });

    const result = buildClassicMatch(partial, [trackedPlayer]);

    expect(result.teams.blue).toHaveLength(3);
    expect(result.teams.red).toHaveLength(2);
  });
});
