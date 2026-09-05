import type {
  DareBooleanExpressionV2,
  DareCompiledPlanV2,
  DareGameSetV2,
  DareResultExpressionV2,
  DareTargetBindingV2,
  DareValueV2,
} from "@scout-for-lol/data";

function targetName(
  key: string,
  targets: readonly DareTargetBindingV2[],
): string {
  const target = targets.find((candidate) => candidate.key === key);
  if (target === undefined) throw new Error(`Unknown Dare v2 target ${key}.`);
  return target.alias;
}

function valueText(
  value: DareValueV2,
  targets: readonly DareTargetBindingV2[],
): string {
  if (value.kind === "participant") {
    return `${targetName(value.target, targets)}'s ${value.field.replaceAll("_", " ")}`;
  }
  if (value.kind === "participant_rate") {
    return `${targetName(value.target, targets)}'s ${value.field.replaceAll("_", " ")}`;
  }
  if (value.kind === "game") {
    return `the game's ${value.field.replaceAll("_", " ")}`;
  }
  if (value.kind === "related_participant_count") {
    const champion = value.championName ?? "players";
    return `the number of ${champion} ${value.relationship}s of ${targetName(value.target, targets)}`;
  }
  if (value.kind === "arithmetic") {
    const operator = {
      add: "plus",
      subtract: "minus",
      multiply: "multiplied by",
      divide: "divided by",
    }[value.operator];
    return `(${valueText(value.left, targets)} ${operator} ${valueText(value.right, targets)})`;
  }
  const owner =
    value.target === null ? "the match" : targetName(value.target, targets);
  const role = value.role === null ? "" : ` as ${value.role}`;
  const bounds = [
    value.afterMs === null
      ? null
      : `after ${(value.afterMs / 1000).toString()} seconds`,
    value.beforeMs === null
      ? null
      : `before ${(value.beforeMs / 1000).toString()} seconds`,
  ].filter((part) => part !== null);
  const item =
    value.itemId === null ? "" : ` for item ${value.itemId.toString()}`;
  // The narrowing has to appear in the plain language, or a dragon dare and a
  // baron dare read identically to the person accepting it.
  const narrowing = [
    value.monsterType === null ? null : `of ${value.monsterType}`,
    value.buildingType === null ? null : `of ${value.buildingType}`,
  ]
    .filter((part) => part !== null)
    .join(" and ");
  const narrowed = narrowing === "" ? "" : ` ${narrowing}`;
  return `${owner}'s ${value.eventType} timeline events${narrowed}${role}${item}${bounds.length === 0 ? "" : ` ${bounds.join(" and ")}`}`;
}

function operatorText(operator: string): string {
  if (operator === "eq") return "equals";
  if (operator === "neq") return "does not equal";
  if (operator === "gte") return "is at least";
  if (operator === "lte") return "is at most";
  if (operator === "gt") return "is greater than";
  if (operator === "lt") return "is less than";
  throw new Error(`Unknown Dare v2 operator ${operator}.`);
}

function predicateText(
  expression: DareBooleanExpressionV2,
  targets: readonly DareTargetBindingV2[],
): string {
  if (expression.kind === "comparison") {
    return `${valueText(expression.value, targets)} ${operatorText(expression.operator)} ${String(expression.threshold)}`;
  }
  if (expression.kind === "not") {
    return `NOT (${predicateText(expression.operand, targets)})`;
  }
  return `(${expression.operands.map((operand) => predicateText(operand, targets)).join(expression.kind === "and" ? " AND " : " OR ")})`;
}

function relationshipText(gameSet: DareGameSetV2): string {
  if (gameSet.relationship === "independent") return "in one game";
  if (gameSet.relationship === "same_match") return "together in one game";
  if (gameSet.relationship === "same_team")
    return "together on the same team in one game";
  return "against each other in one game";
}

function gameSetText(
  gameSet: DareGameSetV2,
  targets: readonly DareTargetBindingV2[],
): string {
  const aliases = gameSet.targetKeys.map((key) => targetName(key, targets));
  const projections =
    gameSet.projections.length === 0
      ? ""
      : `; record ${gameSet.projections.map((projection) => `${projection.name}=${valueText(projection.value, targets)}`).join(", ")}`;
  return `${gameSet.name}: ${aliases.join(", ")} ${relationshipText(gameSet)}, in ${gameSet.queues.join("/")}, first ${gameSet.limit.toString()} eligible games, where ${predicateText(gameSet.predicate, targets)}${projections}`;
}

function resultText(expression: DareResultExpressionV2): string {
  if (expression.kind === "matching_games") {
    return `${expression.gameSet} matching-game count ${operatorText(expression.operator)} ${expression.threshold.toString()}`;
  }
  if (expression.kind === "aggregate") {
    return `${expression.function} of ${expression.gameSet}.${expression.projection} ${operatorText(expression.operator)} ${expression.threshold.toString()}`;
  }
  if (expression.kind === "not")
    return `NOT (${resultText(expression.operand)})`;
  return `(${expression.operands.map((operand) => resultText(operand)).join(expression.kind === "and" ? " AND " : " OR ")})`;
}

export function renderDarePlanV2(
  plan: DareCompiledPlanV2,
  targets: readonly DareTargetBindingV2[],
): string {
  return [
    plan.gameSets.length === 1
      ? "Every condition in this game set must hold in the same game."
      : "Each game set is evaluated independently; different game sets may use different games.",
    ...plan.gameSets.map((gameSet) => gameSetText(gameSet, targets)),
    `The dare succeeds when ${resultText(plan.result)}.`,
  ].join("\n");
}

export function renderDareProofPlanV2(plan: DareCompiledPlanV2): string {
  return [
    "Evaluate matches by game end time, then match ID.",
    ...plan.gameSets.map(
      (gameSet) =>
        `${gameSet.name}: bind ${gameSet.targetKeys.join(", ")} with ${gameSet.relationship}; consider at most ${gameSet.limit.toString()} eligible games; retain the per-match three-valued predicate result and timeline coverage.`,
    ),
    `Evaluate the canonical result expression over at most ${plan.maxEligibleGames.toString()} evidence games. Unknown timeline evidence remains null.`,
  ].join("\n");
}
