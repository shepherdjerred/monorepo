import { describe, expect, test } from "bun:test";
import {
  ClassicMatchSchema,
  PlayerConfigEntrySchema,
} from "#src/model/index.ts";

function classicChampion(index: number) {
  return {
    puuid: `classic-puuid-${index.toString()}`.padEnd(78, "x"),
    riotIdGameName: `Classic Player ${index.toString()}`,
    riotIdTagLine: "JDE",
    championId: 60_000 + index,
    championName: `Jade_Champion_${index.toString()}`,
    kills: index,
    deaths: index,
    assists: index,
    level: 18,
    items: [771_001, 771_004, 771_006, 771_011, 771_018, 771_026, 0],
    spells: [74, 714],
    gold: 12_000,
    creepScore: 200,
  };
}

function classicMatch(blueCount: number, redCount: number) {
  const hero = classicChampion(1);
  const playerConfig = PlayerConfigEntrySchema.parse({
    alias: "Classic Scout",
    league: {
      leagueAccount: {
        puuid: hero.puuid,
        region: "AMERICA_NORTH",
      },
    },
  });
  return {
    durationInSeconds: 1800,
    queueType: "classic",
    mapName: "Classic Rift",
    players: [
      {
        playerConfig,
        outcome: "Victory",
        champion: hero,
        team: "blue",
      },
    ],
    teams: {
      blue: Array.from({ length: blueCount }, (_, index) =>
        classicChampion(index + 1),
      ),
      red: Array.from({ length: redCount }, (_, index) =>
        classicChampion(index + 6),
      ),
    },
  };
}

describe("ClassicMatchSchema", () => {
  test.each([
    [5, 5],
    [3, 2],
    [1, 1],
  ])("accepts Classic %iv%i teams", (blueCount, redCount) => {
    const parsed = ClassicMatchSchema.parse(classicMatch(blueCount, redCount));
    expect(parsed.teams.blue).toHaveLength(blueCount);
    expect(parsed.teams.red).toHaveLength(redCount);
  });

  test.each([
    [0, 1],
    [1, 0],
    [6, 1],
    [1, 6],
  ])("rejects Classic %iv%i teams", (blueCount, redCount) => {
    expect(() =>
      ClassicMatchSchema.parse(classicMatch(blueCount, redCount)),
    ).toThrow();
  });

  test("rejects malformed Classic-only champion fields", () => {
    const input = classicMatch(1, 1);
    const malformedChampion = {
      ...input.teams.blue[0],
      items: [771_001],
      spells: [74],
    };
    expect(() =>
      ClassicMatchSchema.parse({
        ...input,
        teams: { ...input.teams, blue: [malformedChampion] },
      }),
    ).toThrow();
  });
});
