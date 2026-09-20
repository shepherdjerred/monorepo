import { describe, expect, test } from "vitest";
import {
  CHALLENGE_CONTRACT_VERSION,
  CHALLENGE_EVALUATOR_VERSION,
  ChallengeContractV1Schema,
  challengeNeedsPlacement,
  evaluateChallengeContract,
  evaluateChallengePredicate,
  freezeChallengeCatalogs,
  type ChallengeMatchPredicate,
} from "./challenge.ts";
import {
  WIN_EVERY_CURRENT_CHAMPION_ARENA_FIRST_TEMPLATE,
  WIN_EVERY_CURRENT_CHAMPION_ARENA_WIN_TEMPLATE,
  WIN_EVERY_CURRENT_CHAMPION_FLEX_TEMPLATE,
  WIN_EVERY_CURRENT_CHAMPION_SOLO_TEMPLATE,
} from "./challenge-builtins.ts";
import {
  ChallengeEvidenceMatchSchema,
  type ChallengeEvidenceMatch,
} from "./challenge-public.ts";

function evidence(input: {
  id: string;
  championId: number;
  win: boolean;
  kills?: number;
  timeline?: boolean;
  queue?: "solo" | "flex" | "arena";
  placement?: number | null;
}): ChallengeEvidenceMatch {
  return {
    matchId: input.id,
    gameEndAt: `2026-01-${input.id.padStart(2, "0")}T00:00:00.000Z`,
    queue: input.queue ?? "solo",
    championId: input.championId,
    championName: `Champion ${input.championId.toString()}`,
    role: "MIDDLE",
    win: input.win,
    placement: input.placement ?? null,
    kills: input.kills ?? 0,
    deaths: 0,
    assists: 0,
    creep_score: 0,
    gold_earned: 0,
    vision_score: 0,
    champion_damage: 0,
    damage_taken: 0,
    damage_mitigated: 0,
    teammate_healing: 0,
    wards_cleared: 0,
    objective_damage: 0,
    turret_damage: 0,
    crowd_control_time: 0,
    longest_life: 0,
    total_time_dead: 0,
    timelineEvidenceAvailable: input.timeline ?? true,
    timelineEventCounts: {},
  };
}

function evaluateTimelineChallenge(
  matchPredicate: ChallengeMatchPredicate,
): ReturnType<typeof evaluateChallengeContract> {
  const contract = ChallengeContractV1Schema.parse({
    version: 1,
    evaluatorVersion: "challenge-evaluator-1",
    title: "Timeline",
    summary: "Use retained events.",
    explanation: ["Requires timeline evidence."],
    matchPredicate,
    progressGoal: { kind: "count", target: 1 },
  });
  return evaluateChallengeContract(
    contract,
    [evidence({ id: "1", championId: 1, win: true, timeline: false })],
    { startAt: "2026-01-01T00:00:00.000Z", endAt: null },
  );
}

describe("community challenge contracts", () => {
  test("freezes the current champion catalog for solo and flex runs", () => {
    for (const template of [
      WIN_EVERY_CURRENT_CHAMPION_SOLO_TEMPLATE,
      WIN_EVERY_CURRENT_CHAMPION_FLEX_TEMPLATE,
    ]) {
      const frozen = freezeChallengeCatalogs(template);
      expect(frozen.progressGoal.kind).toBe("distinct");
      if (frozen.progressGoal.kind !== "distinct") return;
      expect(frozen.progressGoal.catalog).toBeNull();
      expect(frozen.progressGoal.requiredValues.length).toBeGreaterThan(150);
      expect(frozen.progressGoal.target).toBe(
        frozen.progressGoal.requiredValues.length,
      );
    }
  });

  test("evaluates arena placement predicates correctly", () => {
    const top3 = evaluateChallengeContract(
      freezeChallengeCatalogs(WIN_EVERY_CURRENT_CHAMPION_ARENA_WIN_TEMPLATE),
      [
        evidence({
          id: "1",
          championId: 1,
          win: true,
          queue: "arena",
          placement: 3,
        }),
        evidence({
          id: "2",
          championId: 2,
          win: false,
          queue: "arena",
          placement: 4,
        }),
        evidence({
          id: "3",
          championId: 3,
          win: true,
          queue: "solo",
          placement: null,
        }),
      ],
      { startAt: "2026-01-01T00:00:00.000Z", endAt: null },
    );
    expect(top3.progress.kind).toBe("distinct");
    if (top3.progress.kind === "distinct") {
      expect(top3.progress.current).toBe(1);
      expect(top3.progress.covered[0]?.value).toBe("1");
    }

    const first = evaluateChallengeContract(
      freezeChallengeCatalogs(WIN_EVERY_CURRENT_CHAMPION_ARENA_FIRST_TEMPLATE),
      [
        evidence({
          id: "1",
          championId: 1,
          win: true,
          queue: "arena",
          placement: 1,
        }),
        evidence({
          id: "2",
          championId: 2,
          win: true,
          queue: "arena",
          placement: 2,
        }),
      ],
      { startAt: "2026-01-01T00:00:00.000Z", endAt: null },
    );
    expect(first.progress.kind).toBe("distinct");
    if (first.progress.kind === "distinct") {
      expect(first.progress.current).toBe(1);
      expect(first.progress.covered[0]?.value).toBe("1");
    }
  });
});

describe("challenge goal evaluation and validation", () => {
  test("evaluates count, sum, maximum, streak, distinct, and boolean goals", () => {
    const contract = ChallengeContractV1Schema.parse({
      version: CHALLENGE_CONTRACT_VERSION,
      evaluatorVersion: CHALLENGE_EVALUATOR_VERSION,
      title: "Reducer exercise",
      summary: "Exercises every bounded progress reducer.",
      explanation: ["Win games."],
      matchPredicate: { kind: "result", result: "win" },
      progressGoal: {
        kind: "all",
        goals: [
          { kind: "count", target: 3 },
          { kind: "sum", field: "kills", target: 9 },
          { kind: "maximum", field: "kills", target: 5 },
          { kind: "consecutive_streak", target: 2 },
          {
            kind: "distinct",
            dimension: "champions",
            explicitField: null,
            target: 3,
            catalog: null,
            requiredValues: [
              { value: "1", label: "One" },
              { value: "2", label: "Two" },
              { value: "3", label: "Three" },
            ],
          },
        ],
      },
    });
    const result = evaluateChallengeContract(
      contract,
      [
        evidence({ id: "1", championId: 1, win: true, kills: 2 }),
        evidence({ id: "2", championId: 2, win: true, kills: 5 }),
        evidence({ id: "3", championId: 9, win: false, kills: 20 }),
        evidence({ id: "4", championId: 3, win: true, kills: 2 }),
      ],
      { startAt: "2026-01-01T00:00:00.000Z", endAt: null },
    );
    expect(result.progress.completed).toBe(true);
    expect(result.coverage.evaluatedMatchCount).toBe(4);
  });

  test("reports missing timeline evidence without treating it as a match", () => {
    const result = evaluateTimelineChallenge({
      kind: "timeline_event_count",
      eventType: "CHAMPION_KILL",
      role: "killer",
      operator: "gte",
      threshold: 1,
    });
    expect(result.progress.completed).toBe(false);
    expect(result.coverage.missingTimelineEvidence).toBe(1);
  });

  test("does not let negation turn missing timeline evidence into progress", () => {
    const result = evaluateTimelineChallenge({
      kind: "not",
      predicate: {
        kind: "timeline_event_count",
        eventType: "CHAMPION_KILL",
        role: "killer",
        operator: "gte",
        threshold: 1,
      },
    });
    expect(result.progress.completed).toBe(false);
    expect(result.coverage.missingTimelineEvidence).toBe(1);
  });
});

describe("challenge predicate evaluation and missing evidence", () => {
  test("does not let negation turn missing placement into progress", () => {
    const soloMatch = evidence({
      id: "1",
      championId: 1,
      win: true,
      queue: "solo",
      placement: null,
    });
    const arenaTop3 = evidence({
      id: "2",
      championId: 1,
      win: true,
      queue: "arena",
      placement: 2,
    });
    const arenaBottom = evidence({
      id: "3",
      championId: 1,
      win: false,
      queue: "arena",
      placement: 5,
    });

    const notPlacementLte3: ChallengeMatchPredicate = {
      kind: "not",
      predicate: {
        kind: "numeric",
        field: "placement",
        operator: "lte",
        threshold: 3,
      },
    };

    expect(challengeNeedsPlacement(notPlacementLte3)).toBe(true);
    expect(evaluateChallengePredicate(notPlacementLte3, soloMatch)).toBe(false);
    expect(evaluateChallengePredicate(notPlacementLte3, arenaTop3)).toBe(false);
    expect(evaluateChallengePredicate(notPlacementLte3, arenaBottom)).toBe(
      true,
    );

    const allSoloNotPlacementGt3: ChallengeMatchPredicate = {
      kind: "all",
      predicates: [
        { kind: "queue_in", queues: ["solo"] },
        {
          kind: "not",
          predicate: {
            kind: "numeric",
            field: "placement",
            operator: "gt",
            threshold: 3,
          },
        },
      ],
    };
    expect(evaluateChallengePredicate(allSoloNotPlacementGt3, soloMatch)).toBe(
      false,
    );

    const anySoloNotPlacementGt3: ChallengeMatchPredicate = {
      kind: "any",
      predicates: [
        { kind: "queue_in", queues: ["solo"] },
        {
          kind: "not",
          predicate: {
            kind: "numeric",
            field: "placement",
            operator: "gt",
            threshold: 3,
          },
        },
      ],
    };
    expect(evaluateChallengePredicate(anySoloNotPlacementGt3, soloMatch)).toBe(
      true,
    );
  });

  test("rejects duplicate and incompatible distinct coverage selectors", () => {
    const contract = {
      version: 1,
      evaluatorVersion: "challenge-evaluator-1",
      title: "Invalid coverage",
      summary: "Invalid coverage contract.",
      explanation: ["Invalid."],
      matchPredicate: { kind: "result", result: "win" },
    } as const;

    expect(
      ChallengeContractV1Schema.safeParse({
        ...contract,
        progressGoal: {
          kind: "distinct",
          dimension: "champions",
          explicitField: null,
          target: 2,
          catalog: null,
          requiredValues: [
            { value: "1", label: "One" },
            { value: "1", label: "One again" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      ChallengeContractV1Schema.safeParse({
        ...contract,
        progressGoal: {
          kind: "distinct",
          dimension: "roles",
          explicitField: null,
          target: 1,
          catalog: "current_champions",
          requiredValues: [],
        },
      }).success,
    ).toBe(false);
  });

  test("parses legacy evidence without placement field defaulting to null", () => {
    const parsed = ChallengeEvidenceMatchSchema.parse({
      matchId: "1",
      gameEndAt: "2026-01-01T00:00:00.000Z",
      queue: "solo",
      championId: 1,
      championName: "Annie",
      role: "MIDDLE",
      win: true,
      kills: 1,
      deaths: 0,
      assists: 2,
      creep_score: 100,
      gold_earned: 5000,
      vision_score: 10,
      champion_damage: 10_000,
      damage_taken: 5000,
      damage_mitigated: 2000,
      teammate_healing: 0,
      wards_cleared: 1,
      objective_damage: 1000,
      turret_damage: 500,
      crowd_control_time: 5,
      longest_life: 600,
      total_time_dead: 0,
      timelineEvidenceAvailable: false,
      timelineEventCounts: {},
    });
    expect(parsed.placement).toBeNull();
  });
});
