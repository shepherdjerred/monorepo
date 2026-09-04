import { describe, expect, test } from "vitest";
import {
  DARE_V2_TEST_GAME_SET,
  DARE_V2_TEST_PLAN,
} from "./dare-contract-v2.test-fixtures.ts";
import {
  DareCompiledPlanV2Schema,
  DareStoredPlanV2Schema,
} from "./dare-contract-v2.ts";
import type { DareBooleanExpressionV2 } from "./dare-expression-v2.ts";
import { DARE_TEAM_POSITIONS } from "./dare-domains.ts";

/** A plan whose single game set carries `predicate`. */
function planWithPredicate(predicate: DareBooleanExpressionV2) {
  return {
    ...DARE_V2_TEST_PLAN,
    gameSets: [{ ...DARE_V2_TEST_GAME_SET, predicate }],
  };
}

function participantComparison(
  field: "team_position" | "champion_name",
  threshold: string,
): DareBooleanExpressionV2 {
  return {
    kind: "comparison",
    value: { kind: "participant", target: "T1", field },
    operator: "eq",
    threshold,
  };
}

function parsePlan(predicate: DareBooleanExpressionV2) {
  return DareCompiledPlanV2Schema.safeParse(planWithPredicate(predicate));
}

describe("Dare v2 contract value domains", () => {
  // The regression this whole module exists for: Riot writes MIDDLE, so a
  // contract comparing team_position to "MID" was false for every game that
  // could ever be played — and settled as a funded loss with a house cut.
  test("rejects a team position Riot never emits", () => {
    const result = parsePlan(participantComparison("team_position", "MID"));
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((issue) => issue.message).join(" "),
    ).toContain("MIDDLE");
  });

  test("rejects SUPPORT, which Riot records as UTILITY", () => {
    expect(
      parsePlan(participantComparison("team_position", "SUPPORT")).success,
    ).toBe(false);
  });

  test.each(DARE_TEAM_POSITIONS)("accepts the real position %s", (position) => {
    expect(
      parsePlan(participantComparison("team_position", position)).success,
    ).toBe(true);
  });

  test("rejects an unknown champion", () => {
    expect(
      parsePlan(participantComparison("champion_name", "Ahriii")).success,
    ).toBe(false);
  });

  // Both spellings must survive: the committed paraphrase corpus stores the
  // punctuated display name, while the evaluator compares Data Dragon keys.
  test.each(["Ahri", "Twisted Fate", "TwistedFate", "Wukong"])(
    "accepts the resolvable champion %s",
    (champion) => {
      expect(
        parsePlan(participantComparison("champion_name", champion)).success,
      ).toBe(true);
    },
  );

  // `normalizeChampionName` percent-decodes and throws URIError on a malformed
  // escape; a throw must read as "unknown champion", not crash the parse.
  test("rejects a champion with a malformed percent escape", () => {
    expect(
      parsePlan(participantComparison("champion_name", "100% crit Yasuo"))
        .success,
    ).toBe(false);
  });

  test("rejects a queue outside the queue catalog", () => {
    expect(
      parsePlan({
        kind: "comparison",
        value: { kind: "game", field: "queue" },
        operator: "eq",
        threshold: "RANKED_FLEX_SR",
      }).success,
    ).toBe(false);
  });

  test("accepts a real queue", () => {
    expect(
      parsePlan({
        kind: "comparison",
        value: { kind: "game", field: "queue" },
        operator: "eq",
        threshold: "flex",
      }).success,
    ).toBe(true);
  });

  // Domains must be checked wherever a value appears, not only at the top of a
  // predicate — an unreachable-by-construction leaf nested under not/and is
  // just as unsatisfiable.
  test("rejects an out-of-domain value nested under not and and", () => {
    expect(
      parsePlan({
        kind: "and",
        operands: [
          {
            kind: "not",
            operand: participantComparison("team_position", "JG"),
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("rejects an unknown champion on a related participant count", () => {
    expect(
      parsePlan({
        kind: "comparison",
        value: {
          kind: "related_participant_count",
          target: "T1",
          relationship: "ally",
          championName: "Ahriii",
        },
        operator: "gte",
        threshold: 1,
      }).success,
    ).toBe(false);
  });

  test("leaves numeric comparisons alone", () => {
    expect(
      parsePlan({
        kind: "comparison",
        value: { kind: "participant", target: "T1", field: "kills" },
        operator: "gte",
        threshold: 10,
      }).success,
    ).toBe(true);
  });
});

describe("Dare v2 stored plans stay readable", () => {
  // Tightening the authoring schema must not retroactively break dares already
  // funded against a plan written before the rule existed. Both active dares on
  // beta hold `team_position = 'SUPPORT'`; their callout, progress view, and
  // settlement all re-parse that stored revision.
  const legacyPlan = planWithPredicate(
    participantComparison("team_position", "SUPPORT"),
  );

  test("reads a stored plan whose value predates the domain rule", () => {
    expect(DareStoredPlanV2Schema.safeParse(legacyPlan).success).toBe(true);
  });

  test("still refuses to author that same plan", () => {
    expect(DareCompiledPlanV2Schema.safeParse(legacyPlan).success).toBe(false);
  });

  test("still enforces structural limits when reading a stored plan", () => {
    expect(
      DareStoredPlanV2Schema.safeParse({ ...DARE_V2_TEST_PLAN, gameSets: [] })
        .success,
    ).toBe(false);
  });
});

function timelinePlan(eventType: string) {
  return planWithPredicate({
    kind: "comparison",
    value: {
      kind: "timeline_event_count",
      eventType,
      target: "T1",
      role: "killer",
      afterMs: null,
      beforeMs: null,
      itemId: null,
    },
    operator: "gte",
    threshold: 1,
  });
}

describe("Dare v2 timeline event types", () => {
  // An unrecognised event type counts zero rather than resolving unknown, so it
  // reads as a definite failure and settles as a real loss.
  test("rejects an event type Riot never emits", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse(timelinePlan("DRAGON_KILL")).success,
    ).toBe(false);
  });

  test("rejects BUILDING_DESTROYED, which an old docs table invented", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse(timelinePlan("BUILDING_DESTROYED"))
        .success,
    ).toBe(false);
  });

  test.each(["CHAMPION_KILL", "ELITE_MONSTER_KILL", "ITEM_PURCHASED"])(
    "accepts the real event type %s",
    (eventType) => {
      expect(
        DareCompiledPlanV2Schema.safeParse(timelinePlan(eventType)).success,
      ).toBe(true);
    },
  );
});
