import type {
  DareCompiledPlanV2,
  DareResultExpressionV2,
} from "@scout-for-lol/data";
import { evaluateDareEvidenceV2 } from "#src/betting/dares/evaluation/dare-evaluator-v2.ts";
import type {
  DareMatchEvidenceV2,
  DareTruthValue,
} from "#src/betting/dares/evaluation/dare-evidence-v2.ts";

export type DareFinalityV2 = {
  value: DareTruthValue;
  final: boolean;
  reason:
    | "monotone_success"
    | "monotone_failure"
    | "deadline"
    | "game_cap"
    | "game_sets_full"
    | "reversible"
    | "evidence_watermark"
    | "contract_error";
};

export type DareProofV2 = {
  planVersion: number;
  compilerVersion: string;
  evaluatorVersion: string;
  scoutQlPlanHash: string | null;
  value: boolean;
  booleanBranch: string;
  decisiveAt: string;
  qualifyingMatchIds: string[];
  targetKeys: string[];
  evaluationTrace: string[];
};

function orderedEvidence(
  plan: DareCompiledPlanV2,
  evidence: readonly DareMatchEvidenceV2[],
): DareMatchEvidenceV2[] {
  return evidence
    .toSorted((left, right) => {
      const time = left.gameEndAt.localeCompare(right.gameEndAt);
      return time === 0 ? left.matchId.localeCompare(right.matchId) : time;
    })
    .slice(0, plan.maxEligibleGames);
}

function leafValueIsStable(
  expression: Extract<
    DareResultExpressionV2,
    { kind: "matching_games" | "aggregate" }
  >,
  value: boolean,
): boolean {
  if (expression.kind === "aggregate") return false;
  return value
    ? expression.operator === "gte" || expression.operator === "gt"
    : expression.operator === "lte" || expression.operator === "lt";
}

function expressionValueIsStable(
  plan: DareCompiledPlanV2,
  expression: DareResultExpressionV2,
  evidence: readonly DareMatchEvidenceV2[],
  value: boolean,
): boolean {
  if (expression.kind === "matching_games" || expression.kind === "aggregate") {
    return leafValueIsStable(expression, value);
  }
  if (expression.kind === "not") {
    return expressionValueIsStable(plan, expression.operand, evidence, !value);
  }
  const operands = expression.operands.map((operand) => ({
    expression: operand,
    value: expressionValue(plan, operand, evidence),
  }));
  if (expression.kind === "and") {
    return value
      ? operands.every(
          (operand) =>
            operand.value === true &&
            expressionValueIsStable(plan, operand.expression, evidence, true),
        )
      : operands.some(
          (operand) =>
            operand.value === false &&
            expressionValueIsStable(plan, operand.expression, evidence, false),
        );
  }
  return value
    ? operands.some(
        (operand) =>
          operand.value === true &&
          expressionValueIsStable(plan, operand.expression, evidence, true),
      )
    : operands.every(
        (operand) =>
          operand.value === false &&
          expressionValueIsStable(plan, operand.expression, evidence, false),
      );
}

function allGameSetsFull(
  plan: DareCompiledPlanV2,
  evidence: readonly DareMatchEvidenceV2[],
): boolean {
  return plan.gameSets.every(
    (gameSet) =>
      evidence.filter((row) => row.candidateSets[gameSet.name] === true)
        .length >= gameSet.limit,
  );
}

export function analyzeDareFinalityV2(input: {
  plan: DareCompiledPlanV2;
  evidence: readonly DareMatchEvidenceV2[];
  deadlineReached: boolean;
}): DareFinalityV2 {
  const bounded = orderedEvidence(input.plan, input.evidence);
  const value = evaluateDareEvidenceV2({
    plan: input.plan,
    evidence: bounded,
  });
  if (input.deadlineReached) return { value, final: true, reason: "deadline" };
  if (bounded.length >= input.plan.maxEligibleGames) {
    return { value, final: true, reason: "game_cap" };
  }
  if (allGameSetsFull(input.plan, bounded)) {
    return { value, final: true, reason: "game_sets_full" };
  }
  if (
    value !== null &&
    expressionValueIsStable(input.plan, input.plan.result, bounded, value)
  ) {
    return {
      value,
      final: true,
      reason: value ? "monotone_success" : "monotone_failure",
    };
  }
  return { value, final: false, reason: "reversible" };
}

function expressionValue(
  plan: DareCompiledPlanV2,
  expression: DareResultExpressionV2,
  evidence: readonly DareMatchEvidenceV2[],
): DareTruthValue {
  return evaluateDareEvidenceV2({
    plan: { ...plan, result: expression },
    evidence,
  });
}

type ProofPart = {
  branch: string;
  decisiveAt: string;
  matchIds: string[];
  targetKeys: string[];
  trace: string[];
};

type ProofContext = {
  plan: DareCompiledPlanV2;
  evidence: readonly DareMatchEvidenceV2[];
  expected: boolean;
  settledAt: string;
};

function leafProofPart(
  context: ProofContext,
  expression: Extract<
    DareResultExpressionV2,
    { kind: "matching_games" | "aggregate" }
  >,
  path: readonly number[],
): ProofPart {
  const gameSet = context.plan.gameSets.find(
    (candidate) => candidate.name === expression.gameSet,
  );
  if (gameSet === undefined)
    throw new Error(`Unknown Dare v2 game set ${expression.gameSet}.`);
  const scoped = context.evidence
    .filter((row) => row.candidateSets[gameSet.name] === true)
    .slice(0, gameSet.limit);
  const stable = leafValueIsStable(expression, context.expected);
  let throughDecision = scoped;
  let decisiveAt = context.settledAt;
  if (stable) {
    const index = scoped.findIndex(
      (_row, candidateIndex) =>
        expressionValue(
          context.plan,
          expression,
          scoped.slice(0, candidateIndex + 1),
        ) === context.expected,
    );
    if (index === -1) {
      throw new Error(
        `A stable Dare v2 ${String(context.expected)} leaf has no decisive prefix.`,
      );
    }
    throughDecision = scoped.slice(0, index + 1);
    const decisive = scoped[index];
    if (decisive === undefined) {
      throw new Error("A Dare v2 decisive prefix has no final row.");
    }
    decisiveAt = decisive.gameEndAt;
  }
  const proving = context.expected
    ? throughDecision.filter((row) => row.setResults[gameSet.name] === true)
    : throughDecision;
  return {
    branch: `${path.join(".")}:${expression.kind}:${expression.gameSet}=${String(context.expected)}`,
    decisiveAt,
    matchIds: proving.map((row) => row.matchId),
    targetKeys: [...gameSet.targetKeys],
    trace: throughDecision.flatMap((row) => row.evaluationTrace),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function firstProofPart(parts: readonly { index: number; proof: ProofPart }[]) {
  const ordered = parts.toSorted((left, right) => {
    const time = left.proof.decisiveAt.localeCompare(right.proof.decisiveAt);
    return time === 0 ? left.index - right.index : time;
  });
  const first = ordered[0];
  if (first === undefined) throw new Error("A Dare v2 branch has no proof.");
  return first.proof;
}

function unionProofParts(
  branch: string,
  parts: readonly ProofPart[],
): ProofPart {
  const decisiveAt = parts
    .map((part) => part.decisiveAt)
    .toSorted()
    .at(-1);
  if (decisiveAt === undefined)
    throw new Error("A Dare v2 Boolean proof has no operands.");
  return {
    branch,
    decisiveAt,
    matchIds: unique(parts.flatMap((part) => part.matchIds)),
    targetKeys: unique(parts.flatMap((part) => part.targetKeys)),
    trace: parts.flatMap((part) => part.trace),
  };
}

function proofPart(
  context: ProofContext,
  expression: DareResultExpressionV2,
  path: readonly number[],
): ProofPart {
  if (expression.kind === "matching_games" || expression.kind === "aggregate") {
    return leafProofPart(context, expression, path);
  }
  if (expression.kind === "not") {
    const operand = proofPart(
      { ...context, expected: !context.expected },
      expression.operand,
      [...path, 0],
    );
    return {
      ...operand,
      branch: `${path.join(".")}:not(${operand.branch})`,
    };
  }
  const matchingOperands = expression.operands
    .map((operand, index) => ({ operand, index }))
    .filter(
      ({ operand }) =>
        expressionValue(context.plan, operand, context.evidence) ===
        context.expected,
    );
  const selectsOne =
    (expression.kind === "or" && context.expected) ||
    (expression.kind === "and" && !context.expected);
  if (selectsOne) {
    return firstProofPart(
      matchingOperands.map(({ operand, index }) => ({
        index,
        proof: proofPart(context, operand, [...path, index]),
      })),
    );
  }
  const parts = expression.operands.map((operand, index) =>
    proofPart(context, operand, [...path, index]),
  );
  return unionProofParts(
    `${path.join(".")}:${expression.kind}=${String(context.expected)}`,
    parts,
  );
}

export function buildDareProofV2(input: {
  plan: DareCompiledPlanV2;
  evidence: readonly DareMatchEvidenceV2[];
  value: boolean;
  settledAt: string;
  compilerVersion: string;
  evaluatorVersion: string;
  scoutQlPlanHash: string | null;
}): DareProofV2 {
  const evidence = orderedEvidence(input.plan, input.evidence);
  const part = proofPart(
    {
      plan: input.plan,
      evidence,
      expected: input.value,
      settledAt: input.settledAt,
    },
    input.plan.result,
    [0],
  );
  return {
    planVersion: input.plan.version,
    compilerVersion: input.compilerVersion,
    evaluatorVersion: input.evaluatorVersion,
    scoutQlPlanHash: input.scoutQlPlanHash,
    value: input.value,
    booleanBranch: part.branch,
    decisiveAt: part.decisiveAt,
    qualifyingMatchIds: part.matchIds,
    targetKeys: part.targetKeys,
    evaluationTrace: part.trace,
  };
}
