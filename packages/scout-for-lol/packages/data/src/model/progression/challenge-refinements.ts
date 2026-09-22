import type { RefinementCtx } from "zod";

type DistinctGoalInput = {
  readonly dimension: "champions" | "roles" | "queues" | "explicit_values";
  readonly explicitField: "champion" | "role" | "queue" | null;
  readonly catalog: "current_champions" | null;
  readonly target: number;
  readonly requiredValues: readonly { readonly value: string }[];
};

export function validateDistinctGoal(
  goal: DistinctGoalInput,
  context: RefinementCtx,
): void {
  if (goal.dimension === "explicit_values" && goal.explicitField === null) {
    context.addIssue({
      code: "custom",
      message: "Explicit-value coverage requires an explicit field",
      path: ["explicitField"],
    });
  }
  if (goal.dimension !== "explicit_values" && goal.explicitField !== null) {
    context.addIssue({
      code: "custom",
      message: "Built-in coverage dimensions cannot select an explicit field",
      path: ["explicitField"],
    });
  }
  if (goal.catalog !== null && goal.dimension !== "champions") {
    context.addIssue({
      code: "custom",
      message: "The current champion catalog requires champion coverage",
      path: ["catalog"],
    });
  }
  if (
    new Set(goal.requiredValues.map((entry) => entry.value)).size !==
    goal.requiredValues.length
  ) {
    context.addIssue({
      code: "custom",
      message: "Distinct coverage values must be unique",
      path: ["requiredValues"],
    });
  }
  if (goal.catalog === null && goal.requiredValues.length < goal.target) {
    context.addIssue({
      code: "custom",
      message: "Distinct coverage requires at least target frozen values",
      path: ["requiredValues"],
    });
  }
}

export const MAX_CHALLENGE_DEPTH = 12;
export const MAX_CHALLENGE_NODES = 80;

type ContractComplexity = { nodes: number; depth: number };

type PredicateComplexityInput =
  | { readonly kind: "not"; readonly predicate: PredicateComplexityInput }
  | {
      readonly kind: "all" | "any";
      readonly predicates: readonly PredicateComplexityInput[];
    }
  | {
      readonly kind:
        | "result"
        | "queue_in"
        | "champion_in"
        | "role_in"
        | "numeric"
        | "timeline_event_count";
    };

type GoalComplexityInput =
  | {
      readonly kind: "all" | "any";
      readonly goals: readonly GoalComplexityInput[];
    }
  | {
      readonly kind:
        "count" | "sum" | "maximum" | "consecutive_streak" | "distinct";
    };

export function predicateComplexity(
  predicate: PredicateComplexityInput,
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

export function goalComplexity(goal: GoalComplexityInput): ContractComplexity {
  if (goal.kind === "all" || goal.kind === "any") {
    const children = goal.goals.map((child) => goalComplexity(child));
    return {
      nodes: 1 + children.reduce((total, child) => total + child.nodes, 0),
      depth: 1 + Math.max(...children.map((child) => child.depth)),
    };
  }
  return { nodes: 1, depth: 1 };
}

export function validateContractComplexity(
  contract: {
    readonly matchPredicate: PredicateComplexityInput;
    readonly progressGoal: GoalComplexityInput;
  },
  context: RefinementCtx,
): void {
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
}
