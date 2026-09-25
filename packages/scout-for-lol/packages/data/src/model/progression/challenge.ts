import { z } from "zod";
import { getAllChampions } from "#src/model/riot/champion-registry.ts";
import { QueueTypeSchema } from "#src/model/core/state.ts";
import { TimelineEventParticipantRoleSchema } from "#src/model/reports/timeline-lake-columns.ts";
import type {
  ChallengeCoverage,
  ChallengeEvidenceMatch,
  ChallengeProgress,
} from "#src/model/progression/challenge-public.ts";
import {
  validateContractComplexity,
  validateDistinctGoal,
} from "#src/model/progression/challenge-refinements.ts";

export const CHALLENGE_CONTRACT_VERSION = 1;
export const CHALLENGE_EVALUATOR_VERSION = "challenge-evaluator-1" as const;

export const ChallengeComparisonOperatorSchema = z.enum([
  "eq",
  "neq",
  "gte",
  "lte",
  "gt",
  "lt",
]);
export type ChallengeComparisonOperator = z.infer<
  typeof ChallengeComparisonOperatorSchema
>;

export const ChallengeNumericFieldSchema = z.enum([
  "kills",
  "deaths",
  "assists",
  "creep_score",
  "gold_earned",
  "vision_score",
  "champion_damage",
  "damage_taken",
  "damage_mitigated",
  "teammate_healing",
  "wards_cleared",
  "objective_damage",
  "turret_damage",
  "crowd_control_time",
  "longest_life",
  "total_time_dead",
  "placement",
]);
export type ChallengeNumericField = z.infer<typeof ChallengeNumericFieldSchema>;

export type ChallengeMatchPredicate =
  | { kind: "result"; result: "win" | "loss" }
  | { kind: "queue_in"; queues: z.infer<typeof QueueTypeSchema>[] }
  | { kind: "champion_in"; championIds: number[] }
  | { kind: "role_in"; roles: string[] }
  | {
      kind: "numeric";
      field: ChallengeNumericField;
      operator: ChallengeComparisonOperator;
      threshold: number;
    }
  | {
      kind: "timeline_event_count";
      eventType: string;
      role: z.infer<typeof TimelineEventParticipantRoleSchema>;
      operator: ChallengeComparisonOperator;
      threshold: number;
    }
  | { kind: "all"; predicates: ChallengeMatchPredicate[] }
  | { kind: "any"; predicates: ChallengeMatchPredicate[] }
  | { kind: "not"; predicate: ChallengeMatchPredicate };

export const ChallengeMatchPredicateSchema: z.ZodType<ChallengeMatchPredicate> =
  z.lazy(() =>
    z.union([
      z.strictObject({
        kind: z.literal("result"),
        result: z.enum(["win", "loss"]),
      }),
      z.strictObject({
        kind: z.literal("queue_in"),
        queues: z.array(QueueTypeSchema).min(1),
      }),
      z.strictObject({
        kind: z.literal("champion_in"),
        championIds: z.array(z.number().int().positive()).min(1).max(300),
      }),
      z.strictObject({
        kind: z.literal("role_in"),
        roles: z.array(z.string().min(1).max(40)).min(1).max(20),
      }),
      z.strictObject({
        kind: z.literal("numeric"),
        field: ChallengeNumericFieldSchema,
        operator: ChallengeComparisonOperatorSchema,
        threshold: z.number(),
      }),
      z.strictObject({
        kind: z.literal("timeline_event_count"),
        eventType: z.string().min(1).max(80),
        role: TimelineEventParticipantRoleSchema,
        operator: ChallengeComparisonOperatorSchema,
        threshold: z.number().int().nonnegative(),
      }),
      z.strictObject({
        kind: z.literal("all"),
        predicates: z.array(ChallengeMatchPredicateSchema).min(1).max(20),
      }),
      z.strictObject({
        kind: z.literal("any"),
        predicates: z.array(ChallengeMatchPredicateSchema).min(1).max(20),
      }),
      z.strictObject({
        kind: z.literal("not"),
        predicate: ChallengeMatchPredicateSchema,
      }),
    ]),
  );

export const ChallengeFrozenValueSchema = z.strictObject({
  value: z.string().min(1),
  label: z.string().min(1),
});
export type ChallengeFrozenValue = z.infer<typeof ChallengeFrozenValueSchema>;

export type ChallengeProgressGoal =
  | { kind: "count"; target: number }
  | { kind: "sum"; field: ChallengeNumericField; target: number }
  | { kind: "maximum"; field: ChallengeNumericField; target: number }
  | { kind: "consecutive_streak"; target: number }
  | {
      kind: "distinct";
      dimension: "champions" | "roles" | "queues" | "explicit_values";
      explicitField: "champion" | "role" | "queue" | null;
      target: number;
      catalog: "current_champions" | null;
      requiredValues: ChallengeFrozenValue[];
    }
  | { kind: "all"; goals: ChallengeProgressGoal[] }
  | { kind: "any"; goals: ChallengeProgressGoal[] };

export const ChallengeProgressGoalSchema: z.ZodType<ChallengeProgressGoal> =
  z.lazy(() =>
    z.union([
      z.strictObject({
        kind: z.literal("count"),
        target: z.number().int().positive().max(100_000),
      }),
      z.strictObject({
        kind: z.literal("sum"),
        field: ChallengeNumericFieldSchema,
        target: z.number().positive(),
      }),
      z.strictObject({
        kind: z.literal("maximum"),
        field: ChallengeNumericFieldSchema,
        target: z.number().nonnegative(),
      }),
      z.strictObject({
        kind: z.literal("consecutive_streak"),
        target: z.number().int().positive().max(10_000),
      }),
      z
        .strictObject({
          kind: z.literal("distinct"),
          dimension: z.enum([
            "champions",
            "roles",
            "queues",
            "explicit_values",
          ]),
          explicitField: z.enum(["champion", "role", "queue"]).nullable(),
          target: z.number().int().positive().max(10_000),
          catalog: z.literal("current_champions").nullable(),
          requiredValues: z.array(ChallengeFrozenValueSchema).max(10_000),
        })
        .superRefine(validateDistinctGoal),
      z.strictObject({
        kind: z.literal("all"),
        goals: z.array(ChallengeProgressGoalSchema).min(1).max(20),
      }),
      z.strictObject({
        kind: z.literal("any"),
        goals: z.array(ChallengeProgressGoalSchema).min(1).max(20),
      }),
    ]),
  );

export const ChallengeContractV1Schema = z
  .strictObject({
    version: z.literal(CHALLENGE_CONTRACT_VERSION),
    evaluatorVersion: z.literal(CHALLENGE_EVALUATOR_VERSION),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(1000),
    explanation: z.array(z.string().min(1).max(500)).min(1).max(20),
    matchPredicate: ChallengeMatchPredicateSchema,
    progressGoal: ChallengeProgressGoalSchema,
  })
  .superRefine(validateContractComplexity);
export type ChallengeContractV1 = z.infer<typeof ChallengeContractV1Schema>;

function compare(
  left: number,
  operator: ChallengeComparisonOperator,
  right: number,
): boolean {
  switch (operator) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gte":
      return left >= right;
    case "lte":
      return left <= right;
    case "gt":
      return left > right;
    case "lt":
      return left < right;
  }
}

function predicateMatchesAny(
  predicate: ChallengeMatchPredicate,
  test: (predicate: ChallengeMatchPredicate) => boolean,
): boolean {
  if (test(predicate)) return true;
  return predicate.kind === "not"
    ? predicateMatchesAny(predicate.predicate, test)
    : (predicate.kind === "all" || predicate.kind === "any") &&
        predicate.predicates.some((child) => predicateMatchesAny(child, test));
}

export function challengeNeedsTimeline(
  predicate: ChallengeMatchPredicate,
): boolean {
  return predicateMatchesAny(
    predicate,
    (child) => child.kind === "timeline_event_count",
  );
}

export function challengeNeedsPlacement(
  predicate: ChallengeMatchPredicate,
): boolean {
  return predicateMatchesAny(
    predicate,
    (child) => child.kind === "numeric" && child.field === "placement",
  );
}

export function evaluateChallengePredicate(
  predicate: ChallengeMatchPredicate,
  match: ChallengeEvidenceMatch,
): boolean {
  if (!match.timelineEvidenceAvailable && challengeNeedsTimeline(predicate)) {
    return false;
  }
  switch (predicate.kind) {
    case "result":
      return predicate.result === "win" ? match.win : !match.win;
    case "queue_in":
      return predicate.queues.includes(match.queue);
    case "champion_in":
      return predicate.championIds.includes(match.championId);
    case "role_in":
      return predicate.roles.includes(match.role);
    case "numeric": {
      const value = match[predicate.field];
      return (
        value !== null &&
        compare(value, predicate.operator, predicate.threshold)
      );
    }
    case "timeline_event_count":
      return compare(
        match.timelineEventCounts[predicate.eventType]?.[predicate.role] ?? 0,
        predicate.operator,
        predicate.threshold,
      );
    case "all":
      return predicate.predicates.every((child) =>
        evaluateChallengePredicate(child, match),
      );
    case "any":
      return predicate.predicates.some((child) =>
        evaluateChallengePredicate(child, match),
      );
    case "not":
      return (
        !(
          match.placement === null &&
          challengeNeedsPlacement(predicate.predicate)
        ) && !evaluateChallengePredicate(predicate.predicate, match)
      );
  }
}

function distinctMatchValue(
  goal: Extract<ChallengeProgressGoal, { kind: "distinct" }>,
  match: ChallengeEvidenceMatch,
): string {
  if (goal.dimension === "champions" || goal.explicitField === "champion") {
    return match.championId.toString();
  }
  return goal.dimension === "roles" || goal.explicitField === "role"
    ? match.role
    : match.queue;
}

function longestTrueStreak(matches: readonly boolean[]): number {
  let current = 0;
  let best = 0;
  for (const matched of matches) {
    current = matched ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

function evaluateDistinctGoal(
  goal: Extract<ChallengeProgressGoal, { kind: "distinct" }>,
  matches: readonly ChallengeEvidenceMatch[],
  matched: readonly boolean[],
): ChallengeProgress {
  if (goal.catalog !== null) {
    throw new Error(
      "Challenge distinct catalog must be frozen before evaluation",
    );
  }
  const coveredValues = new Set(
    matches
      .filter((_match, index) => matched[index] === true)
      .map((match) => distinctMatchValue(goal, match)),
  );
  const covered = goal.requiredValues.filter((entry) =>
    coveredValues.has(entry.value),
  );
  const missing = goal.requiredValues.filter(
    (entry) => !coveredValues.has(entry.value),
  );
  return {
    kind: "distinct",
    current: covered.length,
    target: goal.target,
    covered,
    missing,
    completed: covered.length >= goal.target,
  };
}

function aggregateNumericField(
  field: ChallengeNumericField,
  matches: readonly ChallengeEvidenceMatch[],
  matched: readonly boolean[],
  reducer: "sum" | "maximum",
): number {
  const values: number[] = [];
  for (const [index, match] of matches.entries()) {
    if (matched[index] === true && match[field] !== null) {
      values.push(match[field]);
    }
  }
  if (reducer === "sum") {
    return values.reduce((total, value) => total + value, 0);
  }
  return values.length === 0 ? 0 : Math.max(0, ...values);
}

function evaluateScalarGoal(
  goal: Extract<
    ChallengeProgressGoal,
    { kind: "count" | "sum" | "maximum" | "consecutive_streak" }
  >,
  matches: readonly ChallengeEvidenceMatch[],
  matched: readonly boolean[],
): ChallengeProgress {
  const current =
    goal.kind === "count"
      ? matched.filter(Boolean).length
      : goal.kind === "consecutive_streak"
        ? longestTrueStreak(matched)
        : aggregateNumericField(goal.field, matches, matched, goal.kind);
  return {
    kind: "scalar",
    reducer: goal.kind,
    current,
    target: goal.target,
    completed: current >= goal.target,
  };
}

function evaluateGoal(
  goal: ChallengeProgressGoal,
  matches: readonly ChallengeEvidenceMatch[],
  matched: readonly boolean[],
): ChallengeProgress {
  if (goal.kind === "all" || goal.kind === "any") {
    const children = goal.goals.map((child) =>
      evaluateGoal(child, matches, matched),
    );
    return {
      kind: "boolean",
      operator: goal.kind,
      children,
      completed:
        goal.kind === "all"
          ? children.every((child) => child.completed)
          : children.some((child) => child.completed),
    };
  }

  return goal.kind === "distinct"
    ? evaluateDistinctGoal(goal, matches, matched)
    : evaluateScalarGoal(goal, matches, matched);
}

export function evaluateChallengeContract(
  contract: ChallengeContractV1,
  evidence: readonly ChallengeEvidenceMatch[],
  selectedPeriod: ChallengeCoverage["selectedPeriod"],
): { progress: ChallengeProgress; coverage: ChallengeCoverage } {
  const matches = evidence.toSorted(
    (left, right) =>
      left.gameEndAt.localeCompare(right.gameEndAt) ||
      left.matchId.localeCompare(right.matchId),
  );
  const matched = matches.map((match) =>
    evaluateChallengePredicate(contract.matchPredicate, match),
  );
  const needsTimeline = challengeNeedsTimeline(contract.matchPredicate);
  return {
    progress: evaluateGoal(contract.progressGoal, matches, matched),
    coverage: {
      evaluatedMatchCount: matches.length,
      selectedPeriod,
      missingTimelineEvidence: needsTimeline
        ? matches.filter((match) => !match.timelineEvidenceAvailable).length
        : 0,
    },
  };
}

function freezeGoalCatalog(goal: ChallengeProgressGoal): ChallengeProgressGoal {
  if (goal.kind === "all" || goal.kind === "any") {
    return {
      ...goal,
      goals: goal.goals.map((child) => freezeGoalCatalog(child)),
    };
  }
  if (goal.kind !== "distinct" || goal.catalog !== "current_champions") {
    return goal;
  }
  const requiredValues = getAllChampions().map((champion) => ({
    value: champion.id.toString(),
    label: champion.name,
  }));
  return {
    ...goal,
    target: requiredValues.length,
    catalog: null,
    requiredValues,
  };
}

export function freezeChallengeCatalogs(
  contract: ChallengeContractV1,
): ChallengeContractV1 {
  return ChallengeContractV1Schema.parse({
    ...contract,
    progressGoal: freezeGoalCatalog(contract.progressGoal),
  });
}
