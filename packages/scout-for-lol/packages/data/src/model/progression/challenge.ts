import { z } from "zod";
import { getAllChampions } from "#src/model/champion-registry.ts";
import { QueueTypeSchema } from "#src/model/state.ts";
import type {
  ChallengeCoverage,
  ChallengeEvidenceMatch,
  ChallengeProgress,
} from "#src/model/progression/challenge-public.ts";
import { validateDistinctGoal } from "#src/model/progression/challenge-refinements.ts";

export const CHALLENGE_CONTRACT_VERSION = 1;
export const CHALLENGE_EVALUATOR_VERSION = "challenge-evaluator-1" as const;
const MAX_CHALLENGE_DEPTH = 12;
const MAX_CHALLENGE_NODES = 80;

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

type ContractComplexity = { nodes: number; depth: number };

function predicateComplexity(
  predicate: ChallengeMatchPredicate,
): ContractComplexity {
  if (predicate.kind === "not") {
    const child = predicateComplexity(predicate.predicate);
    return { nodes: child.nodes + 1, depth: child.depth + 1 };
  }
  if (predicate.kind === "all" || predicate.kind === "any") {
    const children = predicate.predicates.map((child) =>
      predicateComplexity(child),
    );
    return {
      nodes: 1 + children.reduce((total, child) => total + child.nodes, 0),
      depth: 1 + Math.max(...children.map((child) => child.depth)),
    };
  }
  return { nodes: 1, depth: 1 };
}

function goalComplexity(goal: ChallengeProgressGoal): ContractComplexity {
  if (goal.kind === "all" || goal.kind === "any") {
    const children = goal.goals.map((child) => goalComplexity(child));
    return {
      nodes: 1 + children.reduce((total, child) => total + child.nodes, 0),
      depth: 1 + Math.max(...children.map((child) => child.depth)),
    };
  }
  return { nodes: 1, depth: 1 };
}

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
  .superRefine((contract, context) => {
    const predicate = predicateComplexity(contract.matchPredicate);
    const goal = goalComplexity(contract.progressGoal);
    if (predicate.nodes + goal.nodes > MAX_CHALLENGE_NODES) {
      context.addIssue({
        code: "custom",
        message: `Challenge contracts may contain at most ${MAX_CHALLENGE_NODES.toString()} nodes`,
      });
    }
    if (Math.max(predicate.depth, goal.depth) > MAX_CHALLENGE_DEPTH) {
      context.addIssue({
        code: "custom",
        message: `Challenge contracts may be at most ${MAX_CHALLENGE_DEPTH.toString()} levels deep`,
      });
    }
  });
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

export function challengeNeedsTimeline(
  predicate: ChallengeMatchPredicate,
): boolean {
  if (predicate.kind === "timeline_event_count") return true;
  if (predicate.kind === "not")
    return challengeNeedsTimeline(predicate.predicate);
  return (
    (predicate.kind === "all" || predicate.kind === "any") &&
    predicate.predicates.some((child) => challengeNeedsTimeline(child))
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
    case "numeric":
      return compare(
        match[predicate.field],
        predicate.operator,
        predicate.threshold,
      );
    case "timeline_event_count":
      return compare(
        match.timelineEventCounts[predicate.eventType] ?? 0,
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
      return !evaluateChallengePredicate(predicate.predicate, match);
  }
}

function distinctMatchValue(
  goal: Extract<ChallengeProgressGoal, { kind: "distinct" }>,
  match: ChallengeEvidenceMatch,
): string {
  if (goal.dimension === "champions" || goal.explicitField === "champion") {
    return match.championId.toString();
  }
  if (goal.dimension === "roles" || goal.explicitField === "role") {
    return match.role;
  }
  return match.queue;
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

  if (goal.kind === "distinct") {
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

  let current: number;
  if (goal.kind === "count") {
    current = matched.filter(Boolean).length;
  } else if (goal.kind === "consecutive_streak") {
    current = longestTrueStreak(matched);
  } else {
    const values = matches
      .filter((_match, index) => matched[index] === true)
      .map((match) => match[goal.field]);
    current =
      goal.kind === "sum"
        ? values.reduce((total, value) => total + value, 0)
        : Math.max(0, ...values);
  }
  return {
    kind: "scalar",
    reducer: goal.kind,
    current,
    target: goal.target,
    completed: current >= goal.target,
  };
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
