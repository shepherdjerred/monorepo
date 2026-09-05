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
