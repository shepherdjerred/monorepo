import {
  DareProgressSchema,
  type DareCompiledPlanV2,
  type DareGameSetV2,
  type DareProgress,
  type DareProgressCondition,
  type DareResultExpressionV2,
} from "@scout-for-lol/data";
import type {
  DareMatchEvidenceV2,
  DareTruthValue,
} from "#src/betting/dare-evidence-v2.ts";
import { evaluateDareEvidenceV2 } from "#src/betting/dare-evaluator-v2.ts";

type ProgressContext = {
  plan: DareCompiledPlanV2;
  evidence: readonly DareMatchEvidenceV2[];
  gameSets: ReadonlyMap<string, DareGameSetV2>;
};

function orderedEvidence(
  plan: DareCompiledPlanV2,
  evidence: readonly DareMatchEvidenceV2[],
): DareMatchEvidenceV2[] {
  const unique = new Map<string, DareMatchEvidenceV2>();
  for (const row of evidence) {
    const existing = unique.get(row.matchId);
    if (
      existing !== undefined &&
      JSON.stringify(existing) !== JSON.stringify(row)
    ) {
      throw new Error(
        `Dare progress received conflicting evidence for ${row.matchId}.`,
      );
    }
    unique.set(row.matchId, row);
  }
  return [...unique.values()]
    .toSorted((left, right) => {
      const time = left.gameEndAt.localeCompare(right.gameEndAt);
      return time === 0 ? left.matchId.localeCompare(right.matchId) : time;
    })
    .slice(0, plan.maxEligibleGames);
}

function scopedRows(
  context: ProgressContext,
  gameSet: DareGameSetV2,
): DareMatchEvidenceV2[] {
  return context.evidence
    .filter((row) => row.candidateSets[gameSet.name] === true)
    .slice(0, gameSet.limit);
}

function remainingForComparison(
  operator: string,
  current: number,
  target: number,
): number {
  if (operator === "gte") return Math.max(target - current, 0);
  if (operator === "gt") return Math.max(target + 1 - current, 0);
  if (operator === "lte") return Math.max(current - target, 0);
  if (operator === "lt") return Math.max(current - target + 1, 0);
  return Math.abs(target - current);
}

function aggregateValue(
  functionName: "sum" | "average" | "minimum" | "maximum",
  values: readonly number[],
): number | null {
  if (values.length === 0) return null;
  if (functionName === "sum") {
    return values.reduce((total, value) => total + value, 0);
  }
  if (functionName === "average") {
    return values.reduce((total, value) => total + value, 0) / values.length;
  }
  return functionName === "minimum" ? Math.min(...values) : Math.max(...values);
}

function leafCondition(
  context: ProgressContext,
  expression: Extract<
    DareResultExpressionV2,
    { kind: "matching_games" | "aggregate" }
  >,
  key: string,
): DareProgressCondition {
  const gameSet = context.gameSets.get(expression.gameSet);
  if (gameSet === undefined) {
    throw new Error(
      `Dare progress references unknown game set ${expression.gameSet}.`,
    );
  }
  const rows = scopedRows(context, gameSet);
  const matchedRows = rows.filter(
    (row) => row.setResults[gameSet.name] === true,
  );
  const unknownGames = rows.filter(
    (row) => row.setResults[gameSet.name] === null,
  ).length;
  const value = evaluateDareEvidenceV2({
    plan: { ...context.plan, result: expression },
    evidence: context.evidence,
  });
  if (expression.kind === "matching_games") {
    const current = matchedRows.length;
    return {
      key,
      kind: expression.kind,
      label: `${gameSet.name}: ${expression.operator} ${expression.threshold.toString()} matching games`,
      targetKeys: [...gameSet.targetKeys],
      gameSet: gameSet.name,
      operator: expression.operator,
      current,
      target: expression.threshold,
      remaining: remainingForComparison(
        expression.operator,
        current,
        expression.threshold,
      ),
      matchedGames: current,
      eligibleGames: rows.length,
      unknownGames,
      value,
    };
  }
  const projected = matchedRows.map(
    (row) => row.setValues[gameSet.name]?.[expression.projection] ?? null,
  );
  const knownValues = projected.filter((candidate) => candidate !== null);
  const current = aggregateValue(expression.function, knownValues);
  return {
    key,
    kind: expression.kind,
    label: `${expression.function} ${expression.projection}: ${expression.operator} ${expression.threshold.toString()}`,
    targetKeys: [...gameSet.targetKeys],
    gameSet: gameSet.name,
    operator: expression.operator,
    current,
    target: expression.threshold,
    remaining:
      current === null
        ? null
        : remainingForComparison(
            expression.operator,
            current,
            expression.threshold,
          ),
    matchedGames: matchedRows.length,
    eligibleGames: rows.length,
    unknownGames:
      unknownGames + projected.filter((candidate) => candidate === null).length,
    value,
  };
}

function collectConditions(
  context: ProgressContext,
  expression: DareResultExpressionV2,
  path: readonly number[],
): DareProgressCondition[] {
  if (expression.kind === "matching_games" || expression.kind === "aggregate") {
    return [leafCondition(context, expression, path.join("."))];
  }
  if (expression.kind === "not") {
    return collectConditions(context, expression.operand, [...path, 0]);
  }
  return expression.operands.flatMap((operand, index) =>
    collectConditions(context, operand, [...path, index]),
  );
}

function combinedTruth(values: readonly DareTruthValue[]): DareTruthValue {
  if (values.includes(false)) return false;
  return values.every((value) => value === true) ? true : null;
}

function progressSignature(
  conditions: readonly DareProgressCondition[],
): string {
  return JSON.stringify(
    conditions.map((condition) => ({
      key: condition.key,
      current: condition.current,
      value: condition.value,
      unknownGames: condition.unknownGames,
    })),
  );
}

function changedConditionKeys(
  before: readonly DareProgressCondition[],
  after: readonly DareProgressCondition[],
): string[] {
  return after
    .filter((condition, index) => {
      const previous = before[index];
      return (
        previous === undefined ||
        progressSignature([previous]) !== progressSignature([condition])
      );
    })
    .map((condition) => condition.key);
}

function conditionRegressed(
  previous: DareProgressCondition | undefined,
  current: DareProgressCondition,
): boolean {
  if (previous === undefined) return false;
  if (previous.value === true && current.value === false) return true;
  return (
    previous.remaining !== null &&
    current.remaining !== null &&
    current.remaining > previous.remaining
  );
}

function conditionAdvanced(
  previous: DareProgressCondition | undefined,
  current: DareProgressCondition,
): boolean {
  if (previous === undefined) return false;
  if (previous.value === false && current.value === true) return true;
  return (
    previous.remaining !== null &&
    current.remaining !== null &&
    current.remaining < previous.remaining
  );
}

function progressChangeKind(
  beforeValue: DareTruthValue,
  afterValue: DareTruthValue,
  before: readonly DareProgressCondition[],
  after: readonly DareProgressCondition[],
): "advance" | "regression" | "evidence" {
  if (beforeValue === true && afterValue === false) return "regression";
  if (beforeValue === false && afterValue === true) return "advance";
  const regressed = after.some((condition, index) =>
    conditionRegressed(before[index], condition),
  );
  const advanced = after.some((condition, index) =>
    conditionAdvanced(before[index], condition),
  );
  if (regressed && !advanced) return "regression";
  return advanced ? "advance" : "evidence";
}

function latestMaterialChange(
  plan: DareCompiledPlanV2,
  evidence: readonly DareMatchEvidenceV2[],
) {
  let previousConditions = progressConditions(plan, []);
  let previous = progressSignature(previousConditions);
  let previousValue = evaluateDareEvidenceV2({ plan, evidence: [] });
  let latest: DareProgress["latestMaterialChange"] = null;
  for (const [index, row] of evidence.entries()) {
    const currentEvidence = evidence.slice(0, index + 1);
    const conditions = progressConditions(plan, currentEvidence);
    const signature = progressSignature(conditions);
    if (signature === previous) continue;
    const coverage = row.coverageState === "missing";
    const value = evaluateDareEvidenceV2({ plan, evidence: currentEvidence });
    const kind = coverage
      ? "coverage"
      : progressChangeKind(
          previousValue,
          value,
          previousConditions,
          conditions,
        );
    latest = {
      kind,
      matchId: row.matchId,
      occurredAt: row.gameEndAt,
      summary: coverage
        ? `Match ${row.matchId} has incomplete evidence.`
        : kind === "regression"
          ? `Progress regressed after match ${row.matchId}.`
          : `Progress changed after match ${row.matchId}.`,
      conditionKeys: changedConditionKeys(previousConditions, conditions),
    };
    previous = signature;
    previousConditions = conditions;
    previousValue = value;
  }
  return latest;
}

function progressConditions(
  plan: DareCompiledPlanV2,
  evidence: readonly DareMatchEvidenceV2[],
): DareProgressCondition[] {
  const ordered = orderedEvidence(plan, evidence);
  return collectConditions(
    {
      plan,
      evidence: ordered,
      gameSets: new Map(
        plan.gameSets.map((gameSet) => [gameSet.name, gameSet]),
      ),
    },
    plan.result,
    [0],
  );
}

type ProgressSummaryContext = {
  plan: DareCompiledPlanV2;
  evidence: readonly DareMatchEvidenceV2[];
  conditions: ReadonlyMap<string, DareProgressCondition>;
};

function falseExpressionSummary(
  context: ProgressSummaryContext,
  expression: DareResultExpressionV2,
  path: readonly number[],
): string {
  if (expression.kind === "not") {
    return "The excluded condition is currently satisfied; it must become false.";
  }
  if (expression.kind === "or") {
    return "At least one alternative must still be satisfied.";
  }
  if (expression.kind === "and") {
    const index = expression.operands.findIndex(
      (operand) =>
        evaluateDareEvidenceV2({
          plan: { ...context.plan, result: operand },
          evidence: context.evidence,
        }) !== true,
    );
    const selected = expression.operands[index];
    return selected === undefined
      ? "Waiting for more eligible match evidence."
      : falseExpressionSummary(context, selected, [...path, index]);
  }
  const condition = context.conditions.get(path.join("."));
  if (condition?.remaining === undefined || condition.remaining === null) {
    return "Waiting for more eligible match evidence.";
  }
  return condition.remaining === 0
    ? `${condition.label} is currently satisfied.`
    : `${condition.remaining.toString()} remaining for ${condition.label}.`;
}

function progressSummary(
  context: ProgressSummaryContext,
  value: DareTruthValue,
  final: boolean,
): string {
  if (final) return value === true ? "Dare achieved." : "Dare not achieved.";
  if (value === true) {
    return "All current conditions are satisfied; awaiting finality.";
  }
  if (value === null) return "Waiting for more eligible match evidence.";
  return falseExpressionSummary(context, context.plan.result, [0]);
}

export function deriveDareProgressV2(input: {
  plan: DareCompiledPlanV2;
  evidence: readonly DareMatchEvidenceV2[];
  targetKeys: readonly string[];
  final: boolean;
  finalityReason: string;
}): DareProgress {
  const evidence = orderedEvidence(input.plan, input.evidence);
  const conditions = progressConditions(input.plan, evidence);
  const value = evaluateDareEvidenceV2({ plan: input.plan, evidence });
  const eligibleMatchIds = new Set(
    evidence
      .filter((row) => Object.values(row.candidateSets).includes(true))
      .map((row) => row.matchId),
  );
  const matchedMatchIds = new Set(
    evidence
      .filter((row) => Object.values(row.setResults).includes(true))
      .map((row) => row.matchId),
  );
  return DareProgressSchema.parse({
    value,
    final: input.final,
    finalityReason: input.finalityReason,
    matchedGames: matchedMatchIds.size,
    eligibleGames: eligibleMatchIds.size,
    evidenceGames: evidence.length,
    conditions,
    targets: input.targetKeys.map((targetKey) => {
      const targetConditions = conditions.filter((condition) =>
        condition.targetKeys.includes(targetKey),
      );
      return {
        targetKey,
        conditionKeys: targetConditions.map((condition) => condition.key),
        matchedGames: new Set(
          targetConditions.flatMap((condition) =>
            evidence
              .filter(
                (row) =>
                  condition.gameSet !== null &&
                  row.setResults[condition.gameSet] === true,
              )
              .map((row) => row.matchId),
          ),
        ).size,
        eligibleGames: new Set(
          targetConditions.flatMap((condition) =>
            evidence
              .filter(
                (row) =>
                  condition.gameSet !== null &&
                  row.candidateSets[condition.gameSet] === true,
              )
              .map((row) => row.matchId),
          ),
        ).size,
        value: combinedTruth(
          targetConditions.map((condition) => condition.value),
        ),
      };
    }),
    coverageGaps: evidence
      .filter((row) => row.coverageState === "missing")
      .map((row) => ({
        matchId: row.matchId,
        gameEndAt: row.gameEndAt,
        sourceReferences: row.sourceReferences,
        targetKeys: [...new Set(Object.values(row.targetDependencies).flat())],
        reason: "Required match evidence is incomplete.",
      })),
    latestMaterialChange: latestMaterialChange(input.plan, evidence),
    summary: progressSummary(
      {
        plan: input.plan,
        evidence,
        conditions: new Map(
          conditions.map((condition) => [condition.key, condition]),
        ),
      },
      value,
      input.final,
    ),
  });
}
