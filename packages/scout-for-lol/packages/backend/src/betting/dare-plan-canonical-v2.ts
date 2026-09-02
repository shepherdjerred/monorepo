import {
  DareCompiledPlanV2Schema,
  type DareBooleanExpressionV2,
  type DareCompiledPlanV2,
  type DareResultExpressionV2,
} from "@scout-for-lol/data";

type GameSetNames = ReadonlyMap<
  string,
  { name: string; projections: ReadonlyMap<string, string> }
>;

function stableCompare(left: object, right: object): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function canonicalPredicate(
  expression: DareBooleanExpressionV2,
): DareBooleanExpressionV2 {
  if (expression.kind === "comparison") return expression;
  if (expression.kind === "not") {
    return { kind: "not", operand: canonicalPredicate(expression.operand) };
  }
  return {
    kind: expression.kind,
    operands: expression.operands
      .map((operand) => canonicalPredicate(operand))
      .toSorted(stableCompare),
  };
}

function mappedGameSet(
  original: string,
  mappings: GameSetNames,
): { name: string; projections: ReadonlyMap<string, string> } {
  const mapped = mappings.get(original);
  if (mapped === undefined) {
    throw new Error(`Canonical Dare v2 plan references ${original}.`);
  }
  return mapped;
}

function canonicalResult(
  expression: DareResultExpressionV2,
  mappings: GameSetNames,
): DareResultExpressionV2 {
  if (expression.kind === "matching_games") {
    return {
      ...expression,
      gameSet: mappedGameSet(expression.gameSet, mappings).name,
    };
  }
  if (expression.kind === "aggregate") {
    const mapped = mappedGameSet(expression.gameSet, mappings);
    const projection = mapped.projections.get(expression.projection);
    if (projection === undefined) {
      throw new Error(
        `Canonical Dare v2 plan references ${expression.gameSet}.${expression.projection}.`,
      );
    }
    return {
      ...expression,
      gameSet: mapped.name,
      projection,
    };
  }
  if (expression.kind === "not") {
    return {
      kind: "not",
      operand: canonicalResult(expression.operand, mappings),
    };
  }
  return {
    kind: expression.kind,
    operands: expression.operands
      .map((operand) => canonicalResult(operand, mappings))
      .toSorted(stableCompare),
  };
}

/**
 * Remove author-chosen internal identifiers from a plan before eval comparison.
 * CTE/projection names do not change contract meaning; game-set order does,
 * because it is the canonical proof tie-breaker. Commutative Boolean operands
 * and queues are sorted so paraphrases do not fail only for spelling order.
 */
export function canonicalDarePlanV2(
  input: DareCompiledPlanV2,
): DareCompiledPlanV2 {
  const plan = DareCompiledPlanV2Schema.parse(input);
  const mappings = new Map(
    plan.gameSets.map((gameSet, setIndex) => [
      gameSet.name,
      {
        name: `game_set_${(setIndex + 1).toString()}`,
        projections: new Map(
          gameSet.projections.map((projection, projectionIndex) => [
            projection.name,
            `projection_${(projectionIndex + 1).toString()}`,
          ]),
        ),
      },
    ]),
  );
  const gameSets = plan.gameSets.map((gameSet) => {
    const mapped = mappedGameSet(gameSet.name, mappings);
    return {
      ...gameSet,
      name: mapped.name,
      targetKeys: gameSet.targetKeys.toSorted(),
      queues: gameSet.queues.toSorted(),
      predicate: canonicalPredicate(gameSet.predicate),
      projections: gameSet.projections.map((projection) => ({
        ...projection,
        name:
          mapped.projections.get(projection.name) ??
          (() => {
            throw new Error(`Unmapped Dare v2 projection ${projection.name}.`);
          })(),
      })),
    };
  });
  return DareCompiledPlanV2Schema.parse({
    version: plan.version,
    gameSets,
    result: canonicalResult(plan.result, mappings),
    maxEligibleGames: plan.maxEligibleGames,
  });
}

export function canonicalDarePlanJsonV2(plan: DareCompiledPlanV2): string {
  return JSON.stringify(canonicalDarePlanV2(plan));
}
