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
      eligibleGames: condition.eligibleGames,
      unknownGames: condition.unknownGames,
    })),
  );
}

function latestMaterialChange(
  plan: DareCompiledPlanV2,
  evidence: readonly DareMatchEvidenceV2[],
) {
  let previous = progressSignature(progressConditions(plan, []));
  let latest: DareProgress["latestMaterialChange"] = null;
  for (const [index, row] of evidence.entries()) {
    const conditions = progressConditions(plan, evidence.slice(0, index + 1));
    const signature = progressSignature(conditions);
    if (signature === previous) continue;
    const coverage = row.coverageState === "missing";
    latest = {
      kind: coverage ? "coverage" : "advance",
      matchId: row.matchId,
      occurredAt: row.gameEndAt,
      summary: coverage
        ? `Match ${row.matchId} has incomplete evidence.`
        : `Progress changed after match ${row.matchId}.`,
      conditionKeys: conditions
        .filter((condition, conditionIndex) => {
          const before = progressConditions(plan, evidence.slice(0, index))[
            conditionIndex
          ];
          return (
            before === undefined ||
            progressSignature([before]) !== progressSignature([condition])
          );
        })
        .map((condition) => condition.key),
    };
    previous = signature;
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

function progressSummary(
  value: DareTruthValue,
  final: boolean,
  conditions: readonly DareProgressCondition[],
): string {
  if (final) return value === true ? "Dare achieved." : "Dare not achieved.";
  const next = conditions.find(
    (condition) => condition.value !== true && condition.remaining !== null,
  );
  if (next === undefined) {
    return value === true
      ? "All current conditions are satisfied; awaiting finality."
      : "Waiting for more eligible match evidence.";
  }
  const remaining = next.remaining;
  if (remaining === null) {
    throw new Error("A selected Dare progress condition has no remainder.");
  }
  return remaining === 0
    ? `${next.label} is currently satisfied.`
    : `${remaining.toString()} remaining for ${next.label}.`;
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
    summary: progressSummary(value, input.final, conditions),
  });
}
