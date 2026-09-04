import {
  normalizeChampionName,
  DARE_V2_MAX_EXPRESSION_DEPTH,
  DARE_V2_MAX_JOINED_RELATIONS,
  DARE_V2_MAX_PREDICATES,
  DareCompiledPlanV2Schema,
  type DareBooleanExpressionV2,
  type DareCompiledPlanV2,
  type DareGameSetV2,
  type DareResultExpressionV2,
  type DareTargetBindingV2,
  type DareValueV2,
} from "@scout-for-lol/data";
import {
  dareValueDepth,
  dareValueNeedsTimeline,
  dareValuePrimitiveType,
  dareValueRelatedRelationCount,
  dareValueTargetKeys,
} from "#src/betting/dare-value-v2.ts";

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
function comparisonOperator(operator: string): string {
  if (operator === "eq") return "=";
  if (operator === "neq") return "!=";
  if (operator === "gte") return ">=";
  if (operator === "lte") return "<=";
  if (operator === "gt") return ">";
  if (operator === "lt") return "<";
  throw new Error(`Unknown Dare v2 comparison operator ${operator}.`);
}

function literal(value: string | number | boolean): string {
  if (typeof value === "string") return quote(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return value.toString();
}

function aliasForTarget(gameSet: DareGameSetV2, target: string): string {
  const index = gameSet.targetKeys.indexOf(target);
  if (index === -1) {
    throw new Error(
      `Game set ${gameSet.name} expression references target ${target} outside its bindings.`,
    );
  }
  return `p${index.toString()}`;
}

function arithmeticSql(
  value: Extract<DareValueV2, { kind: "arithmetic" }>,
  gameSet: DareGameSetV2,
): string {
  const left = valueSql(value.left, gameSet);
  const right = valueSql(value.right, gameSet);
  const operator = {
    add: "+",
    subtract: "-",
    multiply: "*",
    divide: "/",
  }[value.operator];
  return value.operator === "divide"
    ? `(${left} / NULLIF(${right}, 0))`
    : `(${left} ${operator} ${right})`;
}

function participantRateSql(
  value: Extract<DareValueV2, { kind: "participant_rate" }>,
): string {
  return `dare_rate(${quote(value.target)}, ${quote(value.field)})`;
}

function relatedParticipantSql(
  value: Extract<DareValueV2, { kind: "related_participant_count" }>,
): string {
  return `dare_related_participant_count(${quote(value.target)}, ${quote(value.relationship)}, ${value.championName === null ? "NULL" : quote(normalizeChampionName(value.championName))})`;
}

function timelineEventCountSql(
  value: Extract<DareValueV2, { kind: "timeline_event_count" }>,
): string {
  const argument = (argumentValue: string | number | null) =>
    argumentValue === null
      ? "NULL"
      : typeof argumentValue === "number"
        ? argumentValue.toString()
        : quote(argumentValue);
  return `dare_timeline_event_count(${quote(value.eventType)}, ${argument(value.target)}, ${argument(value.role)}, ${argument(value.afterMs)}, ${argument(value.beforeMs)}, ${argument(value.itemId)})`;
}

function valueSql(value: DareValueV2, gameSet: DareGameSetV2): string {
  if (value.kind === "participant") {
    return `${aliasForTarget(gameSet, value.target)}.${value.field}`;
  }
  if (value.kind === "participant_rate") {
    return participantRateSql(value);
  }
  if (value.kind === "game") {
    return value.field === "duration_seconds"
      ? "p0.game_duration_seconds"
      : "p0.queue";
  }
  if (value.kind === "related_participant_count") {
    return relatedParticipantSql(value);
  }
  if (value.kind === "arithmetic") {
    return arithmeticSql(value, gameSet);
  }
  return timelineEventCountSql(value);
}

function predicateSql(
  expression: DareBooleanExpressionV2,
  gameSet: DareGameSetV2,
): string {
  if (expression.kind === "comparison") {
    return `${valueSql(expression.value, gameSet)} ${comparisonOperator(expression.operator)} ${literal(expression.threshold)}`;
  }
  if (expression.kind === "not") {
    return `NOT (${predicateSql(expression.operand, gameSet)})`;
  }
  const separator = expression.kind === "and" ? " AND " : " OR ";
  return `(${expression.operands.map((operand) => predicateSql(operand, gameSet)).join(separator)})`;
}

function resultSql(expression: DareResultExpressionV2): string {
  if (expression.kind === "matching_games") {
    return `dare_matching_games(${quote(expression.gameSet)}, ${quote(expression.operator)}, ${expression.threshold.toString()})`;
  }
  if (expression.kind === "aggregate") {
    return `dare_aggregate(${quote(expression.gameSet)}, ${quote(expression.projection)}, ${quote(expression.function)}, ${quote(expression.operator)}, ${expression.threshold.toString()})`;
  }
  if (expression.kind === "not") {
    return `NOT (${resultSql(expression.operand)})`;
  }
  const separator = expression.kind === "and" ? " AND " : " OR ";
  return `(${expression.operands.map((operand) => resultSql(operand)).join(separator)})`;
}

function joinClause(gameSet: DareGameSetV2, index: number): string {
  const alias = `p${index.toString()}`;
  const conditions = [`${alias}.match_id = p0.match_id`];
  if (gameSet.relationship === "same_team") {
    conditions.push(`${alias}.team_id = p0.team_id`);
  }
  if (gameSet.relationship === "opponents") {
    conditions.push(`${alias}.team_id <> p0.team_id`);
  }
  return `JOIN match_participants AS ${alias} ON ${conditions.join(" AND ")}`;
}

function rawGameSetSql(gameSet: DareGameSetV2): string {
  const joins = gameSet.targetKeys
    .slice(1)
    .map((_target, index) => joinClause(gameSet, index + 1));
  const targetBindings = gameSet.targetKeys.map(
    (target, index) =>
      `p${index.toString()}.puuid IN dare_target(${quote(target)})`,
  );
  const where = [
    ...targetBindings,
    `p0.queue IN (${gameSet.queues.map((queue) => quote(queue)).join(", ")})`,
  ];
  return [
    `${gameSet.name}_candidates AS (`,
    "  SELECT p0.match_id, p0.game_end_at,",
    `    ${predicateSql(gameSet.predicate, gameSet)} AS matched${gameSet.projections.length === 0 ? "" : ","}`,
    ...gameSet.projections.map(
      (projection, index) =>
        `    ${valueSql(projection.value, gameSet)} AS ${projection.name}${index === gameSet.projections.length - 1 ? "" : ","}`,
    ),
    "  FROM match_participants AS p0",
    ...joins.map((join) => `  ${join}`),
    `  WHERE ${where.join("\n    AND ")}`,
    ")",
  ].join("\n");
}

function boundedGameSetSql(gameSet: DareGameSetV2): string {
  return [
    `${gameSet.name} AS (`,
    `  SELECT candidates.* FROM ${gameSet.name}_candidates AS candidates`,
    "  JOIN eligible_matches AS eligible ON eligible.match_id = candidates.match_id",
    "  ORDER BY candidates.game_end_at ASC, candidates.match_id ASC",
    `  LIMIT ${gameSet.limit.toString()}`,
    ")",
  ].join("\n");
}

function inspectPredicate(
  expression: DareBooleanExpressionV2,
  depth: number,
  facts: {
    predicates: number;
    maxDepth: number;
    timeline: boolean;
    relatedRelations: number;
  },
): void {
  facts.maxDepth = Math.max(facts.maxDepth, depth);
  if (expression.kind === "comparison") {
    facts.predicates += 1;
    facts.maxDepth = Math.max(
      facts.maxDepth,
      depth + dareValueDepth(expression.value),
    );
    if (dareValueNeedsTimeline(expression.value)) {
      facts.timeline = true;
    }
    facts.relatedRelations += dareValueRelatedRelationCount(expression.value);
    return;
  }
  if (expression.kind === "not") {
    inspectPredicate(expression.operand, depth + 1, facts);
    return;
  }
  for (const operand of expression.operands) {
    inspectPredicate(operand, depth + 1, facts);
  }
}

const valueIsNumeric = (value: DareValueV2): boolean =>
  dareValuePrimitiveType(value) === "number";

function inspectValueBinding(
  value: DareValueV2,
  gameSet: DareGameSetV2,
  issues: string[],
): void {
  for (const target of dareValueTargetKeys(value)) {
    if (!gameSet.targetKeys.includes(target)) {
      issues.push(
        `Game set ${gameSet.name} expression references unbound target ${target}.`,
      );
    }
  }
}

function inspectPredicateBindings(
  expression: DareBooleanExpressionV2,
  gameSet: DareGameSetV2,
  issues: string[],
): void {
  if (expression.kind === "comparison") {
    inspectValueBinding(expression.value, gameSet, issues);
    const expectedType = dareValuePrimitiveType(expression.value);
    if (expectedType === "invalid") {
      issues.push(
        `Game set ${gameSet.name} arithmetic operands must both be numeric.`,
      );
      return;
    }
    if (typeof expression.threshold !== expectedType) {
      issues.push(
        `Game set ${gameSet.name} comparison for ${expression.value.kind} requires a ${expectedType} threshold.`,
      );
    }
    if (
      expectedType !== "number" &&
      expression.operator !== "eq" &&
      expression.operator !== "neq"
    ) {
      issues.push(
        `Game set ${gameSet.name} may only use eq or neq with ${expectedType} values.`,
      );
    }
    return;
  }
  if (expression.kind === "not") {
    inspectPredicateBindings(expression.operand, gameSet, issues);
    return;
  }
  for (const operand of expression.operands) {
    inspectPredicateBindings(operand, gameSet, issues);
  }
}

type ResultInspection = {
  facts: { predicates: number; maxDepth: number };
  gameSets: ReadonlyMap<string, DareGameSetV2>;
  issues: string[];
};

function inspectResult(
  expression: DareResultExpressionV2,
  depth: number,
  inspection: ResultInspection,
): void {
  inspection.facts.maxDepth = Math.max(inspection.facts.maxDepth, depth);
  if (expression.kind === "matching_games" || expression.kind === "aggregate") {
    inspection.facts.predicates += 1;
    const gameSet = inspection.gameSets.get(expression.gameSet);
    if (gameSet === undefined) {
      inspection.issues.push(
        `Result references unknown game set ${expression.gameSet}.`,
      );
    } else if (
      expression.kind === "aggregate" &&
      !gameSet.projections.some(
        (projection) => projection.name === expression.projection,
      )
    ) {
      inspection.issues.push(
        `Result references unknown projection ${expression.gameSet}.${expression.projection}.`,
      );
    }
    return;
  }
  if (expression.kind === "not") {
    inspectResult(expression.operand, depth + 1, inspection);
    return;
  }
  for (const operand of expression.operands) {
    inspectResult(operand, depth + 1, inspection);
  }
}

function inspectProjection(
  projection: DareGameSetV2["projections"][number],
  context: {
    gameSet: DareGameSetV2;
    names: Set<string>;
    facts: { timeline: boolean; relatedRelations: number };
    issues: string[];
  },
): void {
  if (context.names.has(projection.name)) {
    context.issues.push(
      `Game set ${context.gameSet.name} projection names must be unique.`,
    );
  }
  context.names.add(projection.name);
  inspectValueBinding(projection.value, context.gameSet, context.issues);
  if (!valueIsNumeric(projection.value)) {
    context.issues.push(
      `Game set ${context.gameSet.name} projection ${projection.name} must be numeric.`,
    );
  }
  if (dareValuePrimitiveType(projection.value) === "invalid") {
    context.issues.push(
      `Game set ${context.gameSet.name} projection ${projection.name} arithmetic operands must both be numeric.`,
    );
  }
  if (dareValueNeedsTimeline(projection.value)) {
    context.facts.timeline = true;
  }
  context.facts.relatedRelations += dareValueRelatedRelationCount(
    projection.value,
  );
}

function inspectGameSet(
  gameSet: DareGameSetV2,
  targetKeys: ReadonlySet<string>,
  issues: string[],
): {
  predicates: number;
  maxDepth: number;
  timeline: boolean;
  relatedRelations: number;
} {
  if (gameSet.relationship === "independent" && gameSet.targetKeys.length > 1) {
    issues.push(
      `Independent game set ${gameSet.name} must bind exactly one target; use separate game sets for separate games.`,
    );
  }
  if (gameSet.relationship === "opponents" && gameSet.targetKeys.length !== 2) {
    issues.push(
      `Opponent game set ${gameSet.name} must bind exactly two targets.`,
    );
  }
  for (const key of gameSet.targetKeys) {
    if (!targetKeys.has(key)) {
      issues.push(`Game set ${gameSet.name} references unknown target ${key}.`);
    }
  }
  const facts = {
    predicates: 0,
    maxDepth: 0,
    timeline: false,
    relatedRelations: 0,
  };
  inspectPredicate(gameSet.predicate, 1, facts);
  inspectPredicateBindings(gameSet.predicate, gameSet, issues);
  const projectionNames = new Set<string>();
  for (const projection of gameSet.projections) {
    inspectProjection(projection, {
      gameSet,
      names: projectionNames,
      facts,
      issues,
    });
  }
  const relationCount =
    gameSet.targetKeys.length +
    (facts.timeline ? 2 : 0) +
    facts.relatedRelations;
  if (relationCount > DARE_V2_MAX_JOINED_RELATIONS) {
    issues.push(`Game set ${gameSet.name} joins too many relations.`);
  }
  return facts;
}

export function darePlanSemanticIssues(
  planInput: DareCompiledPlanV2,
  targets: readonly DareTargetBindingV2[],
): string[] {
  // safeParse, not parse: the schema's superRefine is the hard gate for plan
  // limits and value domains, and this function's contract is to *return* the
  // problems so the authoring loop can show them. Throwing here would turn a
  // fixable contract into a provider error the model cannot act on.
  const parsed = DareCompiledPlanV2Schema.safeParse(planInput);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => issue.message);
  }
  const plan = parsed.data;
  const issues: string[] = [];
  const targetKeys = new Set(targets.map((target) => target.key));
  if (targetKeys.size !== targets.length)
    issues.push("Target keys must be unique.");
  const gameSetNames = new Set(plan.gameSets.map((gameSet) => gameSet.name));
  const gameSets = new Map(
    plan.gameSets.map((gameSet) => [gameSet.name, gameSet]),
  );
  if (gameSetNames.size !== plan.gameSets.length) {
    issues.push("Game set names must be unique.");
  }
  const facts = { predicates: 0, maxDepth: 0 };
  const referencedTargetKeys = new Set<string>();
  for (const gameSet of plan.gameSets) {
    const setFacts = inspectGameSet(gameSet, targetKeys, issues);
    for (const key of gameSet.targetKeys) referencedTargetKeys.add(key);
    facts.predicates += setFacts.predicates;
    facts.maxDepth = Math.max(facts.maxDepth, setFacts.maxDepth);
  }
  for (const target of targets) {
    if (!referencedTargetKeys.has(target.key)) {
      issues.push(`Frozen target ${target.key} is not used by any game set.`);
    }
  }
  inspectResult(plan.result, 1, { facts, gameSets, issues });
  if (facts.predicates > DARE_V2_MAX_PREDICATES) {
    issues.push(
      `A dare may contain at most ${DARE_V2_MAX_PREDICATES.toString()} predicates.`,
    );
  }
  if (facts.maxDepth > DARE_V2_MAX_EXPRESSION_DEPTH) {
    issues.push(
      `A dare expression may be at most ${DARE_V2_MAX_EXPRESSION_DEPTH.toString()} levels deep.`,
    );
  }
  return issues;
}

export function formatDareScoutQlV2(planInput: DareCompiledPlanV2): string {
  const plan = DareCompiledPlanV2Schema.parse(planInput);
  const eligibleUnion = plan.gameSets
    .map(
      (gameSet) =>
        `    SELECT match_id, game_end_at FROM ${gameSet.name}_candidates`,
    )
    .join("\n    UNION ALL\n");
  return [
    "WITH",
    plan.gameSets.map((gameSet) => rawGameSetSql(gameSet)).join(",\n"),
    ",\neligible_matches AS (",
    "  SELECT match_id, MIN(game_end_at) AS game_end_at",
    "  FROM (",
    eligibleUnion,
    "  )",
    "  GROUP BY match_id",
    "  ORDER BY game_end_at ASC, match_id ASC",
    `  LIMIT ${plan.maxEligibleGames.toString()}`,
    "),",
    plan.gameSets.map((gameSet) => boundedGameSetSql(gameSet)).join(",\n"),
    `SELECT ${resultSql(plan.result)} AS achieved`,
  ].join("\n");
}
