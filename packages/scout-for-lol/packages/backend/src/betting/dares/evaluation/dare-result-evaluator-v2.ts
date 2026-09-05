import type {
  DareCompiledPlanV2,
  DareGameSetV2,
  DareResultExpressionV2,
} from "@scout-for-lol/data";
import type {
  DareMatchEvidenceV2,
  DareTruthValue,
} from "#src/betting/dares/evaluation/dare-evidence-v2.ts";
import {
  andDareTruthV2,
  orDareTruthV2,
} from "#src/betting/dares/evaluation/dare-truth-v2.ts";

function compareCount(
  count: number,
  expression: Extract<DareResultExpressionV2, { kind: "matching_games" }>,
): boolean {
  if (expression.operator === "eq") return count === expression.threshold;
  if (expression.operator === "gte") return count >= expression.threshold;
  if (expression.operator === "lte") return count <= expression.threshold;
  if (expression.operator === "gt") return count > expression.threshold;
  return count < expression.threshold;
}

function scopedRows(
  gameSet: DareGameSetV2,
  evidence: readonly DareMatchEvidenceV2[],
): DareMatchEvidenceV2[] {
  return evidence
    .filter((row) => row.candidateSets[gameSet.name] === true)
    .slice(0, gameSet.limit);
}

function countTruth(
  expression: Extract<DareResultExpressionV2, { kind: "matching_games" }>,
  rows: readonly DareMatchEvidenceV2[],
): DareTruthValue {
  const known = rows.filter(
    (row) => row.setResults[expression.gameSet] === true,
  ).length;
  const unknown = rows.filter(
    (row) => row.setResults[expression.gameSet] === null,
  ).length;
  const outcomes = new Set<boolean>();
  for (let count = known; count <= known + unknown; count += 1) {
    outcomes.add(compareCount(count, expression));
  }
  return outcomes.size === 1 ? ([...outcomes][0] ?? null) : null;
}

function aggregateValue(
  functionName: Extract<
    DareResultExpressionV2,
    { kind: "aggregate" }
  >["function"],
  numbers: readonly number[],
): number {
  if (functionName === "sum") {
    return numbers.reduce((total, value) => total + value, 0);
  }
  if (functionName === "average") {
    return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  }
  return functionName === "minimum"
    ? Math.min(...numbers)
    : Math.max(...numbers);
}

function compareAggregate(
  actual: number,
  expression: Extract<DareResultExpressionV2, { kind: "aggregate" }>,
): boolean {
  if (expression.operator === "eq") return actual === expression.threshold;
  if (expression.operator === "gte") return actual >= expression.threshold;
  if (expression.operator === "lte") return actual <= expression.threshold;
  if (expression.operator === "gt") return actual > expression.threshold;
  return actual < expression.threshold;
}

function aggregateTruth(
  expression: Extract<DareResultExpressionV2, { kind: "aggregate" }>,
  rows: readonly DareMatchEvidenceV2[],
): DareTruthValue {
  if (rows.some((row) => row.setResults[expression.gameSet] === null)) {
    return null;
  }
  const values = rows
    .filter((row) => row.setResults[expression.gameSet] === true)
    .map(
      (row) =>
        row.setValues[expression.gameSet]?.[expression.projection] ?? null,
    );
  if (values.length === 0) return false;
  if (values.includes(null)) return null;
  const numbers = values.filter((value) => value !== null);
  return compareAggregate(
    aggregateValue(expression.function, numbers),
    expression,
  );
}

function resultTruth(
  expression: DareResultExpressionV2,
  evidence: readonly DareMatchEvidenceV2[],
  gameSets: ReadonlyMap<string, DareGameSetV2>,
): DareTruthValue {
  if (expression.kind === "matching_games" || expression.kind === "aggregate") {
    const gameSet = gameSets.get(expression.gameSet);
    if (gameSet === undefined) {
      throw new Error(
        `Dare v2 result references unknown game set ${expression.gameSet}.`,
      );
    }
    const rows = scopedRows(gameSet, evidence);
    return expression.kind === "matching_games"
      ? countTruth(expression, rows)
      : aggregateTruth(expression, rows);
  }
  if (expression.kind === "not") {
    const value = resultTruth(expression.operand, evidence, gameSets);
    return value === null ? null : !value;
  }
  const values = expression.operands.map((operand) =>
    resultTruth(operand, evidence, gameSets),
  );
  return expression.kind === "and"
    ? andDareTruthV2(values)
    : orDareTruthV2(values);
}

export function evaluateDareEvidenceV2(input: {
  plan: DareCompiledPlanV2;
  evidence: readonly DareMatchEvidenceV2[];
}): DareTruthValue {
  const ordered = input.evidence.toSorted((left, right) => {
    const time = left.gameEndAt.localeCompare(right.gameEndAt);
    return time === 0 ? left.matchId.localeCompare(right.matchId) : time;
  });
  const bounded = ordered.slice(0, input.plan.maxEligibleGames);
  const gameSets = new Map(
    input.plan.gameSets.map((gameSet) => [gameSet.name, gameSet]),
  );
  return resultTruth(input.plan.result, bounded, gameSets);
}
