import {
  DareCompiledPlanV2Schema,
  DareStoredPlanV2Schema,
  type DareCompiledPlanV2,
} from "@scout-for-lol/data";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import { beforeAll, describe, expect, test } from "vitest";
import { formatDareScoutQlV2 } from "#src/betting/dare-contract-compiler-v2.ts";
import {
  evaluateDareEvidenceV2,
  evaluateDareMatchV2,
  type DareTimelineEvidenceV2,
} from "#src/betting/dare-evaluator-v2.ts";
import { renderDarePlanV2 } from "#src/betting/dare-render-v2.ts";
import { makeTwistedFateMatch } from "#src/betting/dare-v2-test-fixtures.ts";
import type { DareTargetBindingV2 } from "@scout-for-lol/data";

const TARGET: DareTargetBindingV2 = {
  key: "virmel",
  discordId: "100",
  playerId: 1,
  alias: "Virmel",
  accounts: [
    { puuid: "virmel-puuid", trackingStartedAt: new Date(0).toISOString() },
  ],
};

type ObjectiveNarrowing = {
  eventType?: string;
  monsterType?: string | null;
  buildingType?: string | null;
  target?: string | null;
  role?: "subject" | "killer" | "victim" | "assist" | "creator" | null;
};

/** "Virmel takes at least three dragons." */
function objectivePlanInput(narrowing: ObjectiveNarrowing) {
  return {
    version: 2,
    maxEligibleGames: 100,
    gameSets: [
      {
        name: "qualifying_game",
        targetKeys: ["virmel"],
        relationship: "independent",
        queues: ["solo"],
        predicate: {
          kind: "comparison",
          value: {
            kind: "timeline_event_count",
            eventType: narrowing.eventType ?? "ELITE_MONSTER_KILL",
            target:
              narrowing.target === undefined ? "virmel" : narrowing.target,
            role: narrowing.role === undefined ? "killer" : narrowing.role,
            afterMs: null,
            beforeMs: null,
            itemId: null,
            monsterType: narrowing.monsterType ?? null,
            buildingType: narrowing.buildingType ?? null,
          },
          operator: "gte",
          threshold: 3,
        },
        projections: [],
        orderBy: "game_end_at_asc_match_id_asc",
        limit: 100,
      },
    ],
    result: {
      kind: "matching_games",
      gameSet: "qualifying_game",
      operator: "gte",
      threshold: 1,
    },
  };
}

function objectivePlan(narrowing: ObjectiveNarrowing): DareCompiledPlanV2 {
  return DareCompiledPlanV2Schema.parse(objectivePlanInput(narrowing));
}

/**
 * Three dragons and two barons, but only two of the dragons are Virmel's.
 *
 * The third dragon and both barons are the enemy team's, which is what makes
 * this fixture able to tell a team-correct count from a whole-match one: an
 * unbound count sees five elite monsters and three dragons, while Virmel's own
 * count sees two.
 */
function eliteMonsterTimeline(): DareTimelineEvidenceV2 {
  const monsters = [
    { monsterType: "DRAGON", killer: "virmel-puuid" },
    { monsterType: "DRAGON", killer: "virmel-puuid" },
    { monsterType: "DRAGON", killer: "enemy-puuid" },
    { monsterType: "BARON_NASHOR", killer: "virmel-puuid" },
    { monsterType: "BARON_NASHOR", killer: "enemy-puuid" },
  ];
  return {
    coverage: "complete",
    events: monsters.map((monster, index) => ({
      eventId: `NA1_MONSTER:${index.toString()}`,
      eventType: "ELITE_MONSTER_KILL",
      timestampMs: 600_000 + index * 60_000,
      itemId: null,
      monsterType: monster.monsterType,
      buildingType: null,
    })),
    participants: monsters.map((monster, index) => ({
      eventId: `NA1_MONSTER:${index.toString()}`,
      puuid: monster.killer,
      role: "killer" as const,
    })),
  };
}

let fixture: RawMatch;

beforeAll(async () => {
  fixture = RawMatchSchema.parse(
    await Bun.file(
      new URL("../../../../testdata/rift.json", import.meta.url),
    ).json(),
  );
});

function evaluate(plan: DareCompiledPlanV2) {
  const match = makeTwistedFateMatch(fixture, {
    matchId: "NA1_objective",
    timePlayed: 1800,
    creepScore: 200,
  });
  return evaluateDareEvidenceV2({
    plan,
    evidence: [
      evaluateDareMatchV2({
        plan,
        targets: [TARGET],
        matchData: match,
        queue: "solo",
        timeline: eliteMonsterTimeline(),
      }),
    ],
  });
}

describe("Dare v2 objective events", () => {
  // Before monster_type was exposed, this dare was inexpressible: every elite
  // monster is an ELITE_MONSTER_KILL, so "three dragons" and "three barons"
  // compiled to the same predicate and both counted every kill in the game.
  test("counts only the target's dragons when narrowed to DRAGON", () => {
    // Two of the three dragons are Virmel's, so "at least three" must not hold.
    expect(evaluate(objectivePlan({ monsterType: "DRAGON" }))).toBe(false);
  });

  test("counts every elite monster the target took when not narrowed", () => {
    // Three of the five elite monsters are Virmel's: two dragons and one baron.
    expect(evaluate(objectivePlan({}))).toBe(true);
  });

  test("rejects a monster type Riot never emits", () => {
    expect(() => objectivePlan({ monsterType: "DRAKE" })).toThrow();
  });

  test("names the narrowing in the plain language", () => {
    const text = renderDarePlanV2(objectivePlan({ monsterType: "DRAGON" }), [
      TARGET,
    ]);
    expect(text).toContain("DRAGON");
  });

  // The macro is positional; appending keeps every stored contract's canonical
  // text — and therefore its plan hash — stable.
  test("appends the new arguments to the canonical macro", () => {
    const query = formatDareScoutQlV2(objectivePlan({ monsterType: "DRAGON" }));
    expect(query).toContain(
      "dare_timeline_event_count('ELITE_MONSTER_KILL', 'virmel', 'killer', NULL, NULL, NULL, 'DRAGON', NULL)",
    );
  });
});

describe("Dare v2 objective counts must be attributable", () => {
  // An unbound objective count reads as "Virmel's team takes three dragons" and
  // settles as "either team takes three dragons" — an enemy dragon pays out a
  // funded dare. A team-relative filter is deliberately not offered instead:
  // `killer_team_id` answers it exactly for an elite monster, but BUILDING_KILL
  // carries only `team_id`, whose meaning nothing in this repository pins down,
  // and a filter built on the wrong reading inverts the dare.
  test.each(["ELITE_MONSTER_KILL", "BUILDING_KILL"])(
    "refuses an unbound %s count",
    (eventType) => {
      const result = DareCompiledPlanV2Schema.safeParse(
        objectivePlanInput({ eventType, target: null, role: null }),
      );
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.map((issue) => issue.message).join(" "),
      ).toContain("counts both teams");
    },
  );

  // This one really is a whole-match statement, and its plain language says so,
  // so it stays authorable — the rule is about objectives owned by a side.
  test("still allows an unbound count of an event nobody owns", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse(
        objectivePlanInput({
          eventType: "CHAMPION_KILL",
          target: null,
          role: null,
        }),
      ).success,
    ).toBe(true);
  });

  // Refusing to author is not refusing to read: a plan frozen before this rule
  // must keep settling, or the money it holds is stranded.
  test("still reads an unbound objective count from a stored plan", () => {
    expect(
      DareStoredPlanV2Schema.safeParse(
        objectivePlanInput({ target: null, role: null }),
      ).success,
    ).toBe(true);
  });
});

describe("Dare v2 objective narrowings must match their event type", () => {
  // Riot writes monster_type only on ELITE_MONSTER_KILL and building_type only
  // on BUILDING_KILL. A mismatched pair compares against a column that is null
  // in every row, so it counts zero in every game that could ever be played —
  // and zero is a definite failure that settles as a real loss.
  test("refuses a building type on an elite monster kill", () => {
    const result = DareCompiledPlanV2Schema.safeParse(
      objectivePlanInput({
        eventType: "ELITE_MONSTER_KILL",
        buildingType: "TOWER_BUILDING",
      }),
    );
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((issue) => issue.message).join(" "),
    ).toContain("count zero in every game");
  });

  test("refuses a monster type on a building kill", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse(
        objectivePlanInput({
          eventType: "BUILDING_KILL",
          monsterType: "DRAGON",
        }),
      ).success,
    ).toBe(false);
  });

  test("refuses a monster type on a champion kill", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse(
        objectivePlanInput({
          eventType: "CHAMPION_KILL",
          monsterType: "DRAGON",
        }),
      ).success,
    ).toBe(false);
  });

  test("refuses both narrowings at once", () => {
    const result = DareCompiledPlanV2Schema.safeParse(
      objectivePlanInput({
        eventType: "ELITE_MONSTER_KILL",
        monsterType: "DRAGON",
        buildingType: "TOWER_BUILDING",
      }),
    );
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((issue) => issue.message).join(" "),
    ).toContain("never both");
  });

  test("accepts each narrowing on its own event type", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse(
        objectivePlanInput({
          eventType: "BUILDING_KILL",
          buildingType: "TOWER_BUILDING",
        }),
      ).success,
    ).toBe(true);
  });

  // The mismatch rule belongs to authoring, like every other value domain: a
  // funded dare holding an impossible pair still has to render and settle.
  test("still reads a mismatched narrowing from a stored plan", () => {
    expect(
      DareStoredPlanV2Schema.safeParse(
        objectivePlanInput({
          eventType: "CHAMPION_KILL",
          monsterType: "DRAGON",
        }),
      ).success,
    ).toBe(true);
  });
});

function objectiveWithRole(role: string | null) {
  return {
    version: 2,
    maxEligibleGames: 100,
    gameSets: [
      {
        name: "qualifying_game",
        targetKeys: ["virmel"],
        relationship: "independent",
        queues: ["solo"],
        predicate: {
          kind: "comparison",
          value: {
            kind: "timeline_event_count",
            eventType: "ELITE_MONSTER_KILL",
            target: "virmel",
            role,
            afterMs: null,
            beforeMs: null,
            itemId: null,
            monsterType: "DRAGON",
            buildingType: null,
          },
          operator: "gte",
          threshold: 1,
        },
        projections: [],
        orderBy: "game_end_at_asc_match_id_asc",
        limit: 100,
      },
    ],
    result: {
      kind: "matching_games",
      gameSet: "qualifying_game",
      operator: "gte",
      threshold: 1,
    },
  };
}

describe("Dare v2 objective attribution roles", () => {
  // The evaluator filters on the exact role, and only killer/assist appear on
  // an objective event. Any other role counts zero in every game — a funded
  // dare that cannot be won, which is the failure this whole module refuses.
  test.each(["victim", "subject", "creator"])(
    "rejects the non-attributing role %s",
    (role) => {
      expect(
        DareCompiledPlanV2Schema.safeParse(objectiveWithRole(role)).success,
      ).toBe(false);
    },
  );

  test("rejects a null role on an objective count", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse(objectiveWithRole(null)).success,
    ).toBe(false);
  });

  test.each(["killer", "assist"])("accepts the attributing role %s", (role) => {
    expect(
      DareCompiledPlanV2Schema.safeParse(objectiveWithRole(role)).success,
    ).toBe(true);
  });

  // Stored plans must keep parsing regardless: the rule is authoring-only.
  test("still reads a stored plan holding a non-attributing role", () => {
    expect(
      DareStoredPlanV2Schema.safeParse(objectiveWithRole("victim")).success,
    ).toBe(true);
  });
});
