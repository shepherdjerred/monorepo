import type { Champion } from "#src/model/champion.ts";
import type { Lane } from "#src/model/lane.ts";

/**
 * A zeroed `Champion` for tests that care about roster shape or lane pairing
 * rather than statistics. Override whatever the test is actually about.
 */
export function testChampion(
  name: string,
  overrides: Partial<Champion> = {},
): Champion {
  return {
    riotIdGameName: name,
    riotIdTagLine: "NA1",
    championName: name,
    kills: 0,
    deaths: 0,
    assists: 0,
    level: 1,
    items: [0, 0, 0, 0, 0, 0, 0],
    spells: [4, 14],
    gold: 0,
    runes: [],
    creepScore: 0,
    visionScore: 0,
    damage: 0,
    ...overrides,
  };
}

export function testChampionInLane(
  name: string,
  lane: Lane | undefined,
): Champion {
  return testChampion(name, { lane });
}
