import { describe, expect, test } from "vitest";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import type {
  ChampionMetaFile,
  ChampionSlice,
  MatchupFile,
  MetaContext,
} from "#src/meta/meta-serving.ts";
import {
  type ChampionId,
  ChampionIdSchema,
} from "#src/model/core/identifiers.ts";
import { LANE_ORDER, type Lane } from "#src/model/riot/lane.ts";
import {
  DEFAULT_TIP_PLAN_RULES,
  type TipPlanChampionLane,
  type TipPlanOpponent,
  type TipPlanSource,
  planTips,
  selectOpponents,
} from "#src/tips/plan.ts";
import {
  lanePriorTipPlanSource,
  metaTipPlanSource,
} from "#src/tips/plan-sources.ts";

const id = (value: number): ChampionId => ChampionIdSchema.parse(value);

function fixtureSource(input: {
  laneGames: Partial<Record<Lane, number>>;
  championLanes: TipPlanChampionLane[];
  opponents: Record<string, TipPlanOpponent[]>;
}): TipPlanSource {
  return {
    name: "fixture",
    laneGames: (lane) => input.laneGames[lane] ?? 0,
    championLanes: () => input.championLanes,
    opponents: (championId, lane) =>
      input.opponents[`${championId.toString()}:${lane}`] ?? [],
  };
}

describe("planTips on a fixture", () => {
  const source = fixtureSource({
    laneGames: { middle: 1000, top: 1000 },
    championLanes: [
      // Viable: 80% of its games, 8% of the lane.
      { championId: id(1), lane: "middle", games: 80, championGames: 100 },
      // Below 10% of the champion's games.
      { championId: id(1), lane: "top", games: 9, championGames: 100 },
      // Viable at exactly the thresholds: 10% of its games, 0.5% of the lane.
      { championId: id(2), lane: "middle", games: 5, championGames: 50 },
      // Below 0.5% of the lane's picks.
      { championId: id(3), lane: "top", games: 4, championGames: 4 },
    ],
    opponents: {
      "1:middle": [
        { championId: id(2), games: 30 },
        { championId: id(4), games: 20 },
        { championId: id(5), games: 10 },
        { championId: id(6), games: 10 },
        { championId: id(1), games: 10 },
      ],
      "2:middle": [
        { championId: id(1), games: 3 },
        { championId: id(7), games: 1 },
      ],
    },
  });

  test("keeps viable champion-lanes at the thresholds", () => {
    const plan = planTips(source);
    expect(
      plan.championLanes.map((entry) => [entry.championId, entry.lane]),
    ).toEqual([
      [1, "middle"],
      [2, "middle"],
    ]);
  });

  test("keeps opponents until 60% of lane games are covered, without mirrors", () => {
    const plan = planTips(source);
    expect(plan.championLanes[0]?.opponents).toEqual([2, 4]);
    expect(plan.championLanes[0]?.coverage).toBeCloseTo(50 / 80);
    // 3 of 5 games is already 60%.
    expect(plan.championLanes[1]?.opponents).toEqual([1]);
  });

  test("counts an unordered pair once and writes both directions", () => {
    const plan = planTips(source);
    expect(plan.units).toEqual([
      { lane: "middle", championIds: [1, 2] },
      { lane: "middle", championIds: [1, 4] },
    ]);
    expect(plan.counts).toMatchObject({
      championLanes: 2,
      units: 2,
      orderedSets: 4,
    });
    expect(plan.counts.byLane.middle).toEqual({ championLanes: 2, units: 2 });
    expect(plan.counts.byLane.top).toEqual({ championLanes: 0, units: 0 });
  });

  test("caps opponents at 15", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      championId: id(index + 10),
      games: 1,
    }));
    expect(
      selectOpponents(id(1), 30, many, DEFAULT_TIP_PLAN_RULES).opponents,
    ).toHaveLength(15);
  });
});

describe("planTips on the committed lane priors", () => {
  const plan = planTips(lanePriorTipPlanSource(currentLanePriors));

  test("prunes the matrix to a fraction of every champion in every lane", () => {
    const champions = currentLanePriors.champions.length;
    const fullMatrix = champions * (champions - 1) * LANE_ORDER.length;
    expect(plan.counts.championLanes).toBeGreaterThan(champions);
    expect(plan.counts.championLanes).toBeLessThan(champions * 2);
    expect(plan.counts.orderedSets).toBe(plan.counts.units * 2);
    expect(plan.counts.orderedSets).toBeLessThan(fullMatrix * 0.1);
    for (const lane of LANE_ORDER) {
      expect(plan.counts.byLane[lane].championLanes).toBeGreaterThan(10);
    }
  });

  test("every kept opponent list respects the cap and the coverage target", () => {
    for (const entry of plan.championLanes) {
      expect(entry.opponents.length).toBeLessThanOrEqual(15);
      expect(entry.opponents).not.toContain(entry.championId);
      if (entry.opponents.length < 15) {
        expect(entry.coverage).toBeGreaterThanOrEqual(0.6);
      }
    }
  });
});

const META_CONTEXT: MetaContext = {
  patch: "16.23",
  queueId: 420,
  queue: "ranked_solo",
  bracket: "all",
};
function rate(value: number): { value: number; lower: number; upper: number } {
  return { value, lower: value, upper: value };
}
const slice = (
  role: ChampionSlice["context"]["role"],
  games: number,
  roleShare: number,
): ChampionSlice => ({
  context: { ...META_CONTEXT, role },
  sample: { games, matches: 1000 },
  winRate: rate(0.5),
  pickRate: rate(games / 1000),
  banRate: rate(0),
  roleShare: rate(roleShare),
  tier: "B",
  coreItems: [],
  buildPaths: [],
  startingItems: [],
  runes: [],
  spells: [],
  skillOrders: [],
  itemLift: [],
});
const championFile = (
  championId: number,
  slices: ChampionSlice[],
): ChampionMetaFile => ({
  schemaVersion: 1,
  buildId: "b1",
  championId,
  championName: `Champion ${championId.toString()}`,
  slices,
});
describe("metaTipPlanSource", () => {
  const matchupFile: MatchupFile = {
    schemaVersion: 1,
    buildId: "b1",
    championId: 103,
    championName: "Ahri",
    slices: [
      {
        context: { ...META_CONTEXT, role: "MIDDLE" },
        opponents: [
          {
            championId: 134,
            championName: "Syndra",
            games: 150,
            wins: 70,
            winRate: rate(0.47),
          },
          {
            championId: 61,
            championName: "Orianna",
            games: 60,
            wins: 30,
            winRate: rate(0.5),
          },
        ],
      },
      {
        context: { ...META_CONTEXT, patch: "16.22", role: "MIDDLE" },
        opponents: [
          {
            championId: 7,
            championName: "LeBlanc",
            games: 900,
            wins: 400,
            winRate: rate(0.44),
          },
        ],
      },
    ],
  };

  test("plans from real matchup counts in one context", () => {
    const plan = planTips(
      metaTipPlanSource({
        champions: [
          championFile(103, [
            slice("MIDDLE", 300, 0.95),
            slice("TOP", 4, 0.01),
          ]),
          championFile(134, [slice("MIDDLE", 280, 0.9)]),
        ],
        matchups: [matchupFile],
        context: { patch: "16.23", queueId: 420, bracket: "all" },
      }),
    );
    expect(
      plan.championLanes.map((entry) => [
        entry.championId,
        entry.lane,
        entry.opponents,
      ]),
    ).toEqual([
      [103, "middle", [134, 61]],
      [134, "middle", []],
    ]);
    expect(plan.units).toEqual([
      { lane: "middle", championIds: [61, 103] },
      { lane: "middle", championIds: [103, 134] },
    ]);
    expect(plan.counts.orderedSets).toBe(4);
  });
});
