import { describe, expect, test } from "bun:test";
import {
  aggregateGroupFacts,
  type GroupFactRow,
} from "#src/reports/group-combinations.ts";

function fact(overrides: Partial<GroupFactRow>): GroupFactRow {
  return {
    playerId: 1,
    playerAlias: "P1",
    matchId: "NA1_1",
    teamId: 100,
    playerSubteamId: null,
    win: true,
    surrendered: false,
    kills: 1,
    deaths: 1,
    assists: 1,
    creepScore: 10,
    damageToChampions: 100,
    goldEarned: 0,
    visionScore: 0,
    damageTaken: 0,
    totalDamageDealt: 0,
    wardsPlaced: 0,
    multikills: 0,
    gameDurationSeconds: 1800,
    timePlayedSeconds: 1800,
    earlySurrendered: false,
    laneMinions: 0,
    neutralMinions: 0,
    goldSpent: 0,
    damageMitigated: 0,
    damageToObjectives: 0,
    damageToTurrets: 0,
    healing: 0,
    teammateHealing: 0,
    wardsKilled: 0,
    controlWardsBought: 0,
    detectorWardsPlaced: 0,
    doubleKills: 0,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    largestMultikill: 0,
    killingSprees: 0,
    firstBlood: false,
    championLevel: 0,
    championExperience: 0,
    timeDeadSeconds: 0,
    longestLifeSeconds: 0,
    ccTimeSeconds: 0,
    turretKills: 0,
    inhibitorKills: 0,
    dragonKills: 0,
    baronKills: 0,
    placement: null,
    ...overrides,
  };
}

function stack(
  matchId: string,
  count: number,
  overrides: Partial<GroupFactRow> = {},
): GroupFactRow[] {
  return Array.from({ length: count }, (_, index) =>
    fact({
      matchId,
      playerId: index + 1,
      playerAlias: `P${(index + 1).toString()}`,
      ...overrides,
    }),
  );
}

describe("aggregateGroupFacts", () => {
  test("group(2) on a 5-stack yields all C(5,2)=10 pairs", () => {
    const rows = aggregateGroupFacts(stack("NA1_1", 5), 2);
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.games === 1)).toBe(true);
  });

  test("group(3) on a 5-stack yields all C(5,3)=10 trios with summed stats", () => {
    const rows = aggregateGroupFacts(stack("NA1_1", 5), 3);
    expect(rows).toHaveLength(10);
    const first = rows.find((row) => row.label === "P1 + P2 + P3");
    expect(first).toBeDefined();
    expect(first?.kills).toBe(3);
    expect(first?.creepScore).toBe(30);
    // Duration counts once per group-game, not per member.
    expect(first?.durationSeconds).toBe(1800);
    expect(first?.timePlayedSeconds).toBe(5400);
  });

  test("group(all) on a 5-stack yields every size 2..5", () => {
    const rows = aggregateGroupFacts(stack("NA1_1", 5), "all");
    // C(5,2)+C(5,3)+C(5,4)+C(5,5) = 10+10+5+1
    expect(rows).toHaveLength(26);
    const full = rows.find((row) => row.label === "P1 + P2 + P3 + P4 + P5");
    expect(full?.games).toBe(1);
  });

  test("a group wins only when every member wins", () => {
    const rows = aggregateGroupFacts(
      [
        fact({ playerId: 1, playerAlias: "P1", win: true }),
        fact({ playerId: 2, playerAlias: "P2", win: false, surrendered: true }),
      ],
      2,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.wins).toBe(0);
    expect(rows[0]?.surrenders).toBe(1);
  });

  test("Arena: same team side never pairs across subteams", () => {
    const rows = aggregateGroupFacts(
      [
        fact({ playerId: 1, playerAlias: "P1", playerSubteamId: 1 }),
        fact({ playerId: 2, playerAlias: "P2", playerSubteamId: 1 }),
        fact({ playerId: 3, playerAlias: "P3", playerSubteamId: 2 }),
        fact({ playerId: 4, playerAlias: "P4", playerSubteamId: 2 }),
      ],
      2,
    );
    expect(rows.map((row) => row.label).toSorted()).toEqual([
      "P1 + P2",
      "P3 + P4",
    ]);
  });

  test("Arena: a 3-person subteam under group(all) yields 3 pairs + 1 trio", () => {
    const rows = aggregateGroupFacts(
      [
        fact({ playerId: 1, playerAlias: "P1", playerSubteamId: 3 }),
        fact({ playerId: 2, playerAlias: "P2", playerSubteamId: 3 }),
        fact({ playerId: 3, playerAlias: "P3", playerSubteamId: 3 }),
      ],
      "all",
    );
    expect(rows).toHaveLength(4);
    expect(
      rows.filter((row) => row.label.split(" + ").length === 2),
    ).toHaveLength(3);
    expect(
      rows.filter((row) => row.label.split(" + ").length === 3),
    ).toHaveLength(1);
  });

  test("accumulates the same tuple across matches", () => {
    const rows = aggregateGroupFacts(
      [
        ...stack("NA1_1", 2, { win: true }),
        ...stack("NA1_2", 2, { win: false }),
      ],
      2,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.games).toBe(2);
    expect(rows[0]?.wins).toBe(1);
  });

  test("dedupes multi-account players within a unit (last fact wins)", () => {
    const rows = aggregateGroupFacts(
      [
        fact({ playerId: 1, playerAlias: "P1", kills: 1 }),
        fact({ playerId: 1, playerAlias: "P1", kills: 9 }),
        fact({ playerId: 2, playerAlias: "P2", kills: 5 }),
      ],
      2,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kills).toBe(14);
  });

  test("requested size larger than the roster yields nothing", () => {
    expect(aggregateGroupFacts(stack("NA1_1", 2), 4)).toHaveLength(0);
  });

  test("perf sanity: 10k full 5-stack units under group(all)", () => {
    const facts: GroupFactRow[] = [];
    for (let matchIndex = 0; matchIndex < 10_000; matchIndex++) {
      // 20 rotating rosters so distinct tuples accumulate real game counts.
      const base = (matchIndex % 20) * 5;
      for (let member = 0; member < 5; member++) {
        facts.push(
          fact({
            matchId: `NA1_${matchIndex.toString()}`,
            playerId: base + member + 1,
            playerAlias: `P${(base + member + 1).toString()}`,
          }),
        );
      }
    }
    const startedAt = performance.now();
    const rows = aggregateGroupFacts(facts, "all");
    const elapsedMs = performance.now() - startedAt;
    // 20 rosters × 26 combinations each.
    expect(rows).toHaveLength(520);
    expect(elapsedMs).toBeLessThan(2000);
  });
});
