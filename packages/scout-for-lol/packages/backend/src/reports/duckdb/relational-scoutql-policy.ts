import type { RelationalScoutQlComplexityLimits } from "#src/reports/duckdb/relational-scoutql-limits.ts";

export function appendRelationalScoutQlLimitIssues(
  facts: {
    cteCount: number;
    joinedRelations: number;
    predicates: number;
    maxExpressionDepth: number;
  },
  limits: RelationalScoutQlComplexityLimits,
  issues: string[],
): void {
  const measuredLimits = [
    { actual: facts.cteCount, maximum: limits.ctes, label: "CTEs" },
    {
      actual: facts.joinedRelations,
      maximum: limits.joinedRelations,
      label: "joined relations",
    },
    {
      actual: facts.predicates,
      maximum: limits.predicates,
      label: "predicates",
    },
  ];
  for (const limit of measuredLimits) {
    if (limit.actual > limit.maximum) {
      issues.push(
        `ScoutQL may contain at most ${limit.maximum.toString()} ${limit.label}.`,
      );
    }
  }
  if (facts.maxExpressionDepth > limits.expressionDepth) {
    issues.push(
      `ScoutQL expressions may be at most ${limits.expressionDepth.toString()} levels deep.`,
    );
  }
}

export function appendRelationalScoutQlCatalogIssues(input: {
  physicalSources: readonly string[];
  functions: readonly string[];
  targetKeys: readonly string[];
  allowedTargetKeys: ReadonlySet<string>;
  allowedSources: ReadonlySet<string>;
  allowedFunctions: ReadonlySet<string>;
  issues: string[];
}): void {
  for (const source of input.physicalSources) {
    if (!input.allowedSources.has(source)) {
      input.issues.push(
        `ScoutQL source ${source} is not in the closed source catalog.`,
      );
    }
  }
  for (const functionName of input.functions) {
    if (!input.allowedFunctions.has(functionName)) {
      input.issues.push(
        `ScoutQL function ${functionName} is not in the closed function catalog.`,
      );
    }
  }
  for (const targetKey of input.targetKeys) {
    if (!input.allowedTargetKeys.has(targetKey)) {
      input.issues.push(
        `ScoutQL target ${targetKey} is not a frozen dare target.`,
      );
    }
  }
}
