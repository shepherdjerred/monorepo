import { z } from "zod";
import {
  DareCompiledPlanV2Schema,
  type DareCompiledPlanV2,
  type DareGameSetV2,
  type DareTargetBindingV2,
  QueueTypeSchema,
} from "@scout-for-lol/data";
import {
  astArray,
  astObject,
  astString,
  constantValue,
  DareScoutQlProfileError,
  expressionClass,
  expressionType,
  flattenAnd,
  functionExpression,
  limitFromNode,
  requiredStringArgument,
  type AstObject,
  type RelationalScoutQlAstValue,
} from "#src/betting/dares/sql/dare-scoutql-ast-v2.ts";
import {
  darePlanSemanticIssues,
  formatDareScoutQlV2,
} from "#src/betting/dares/evaluation/dare-contract-compiler-v2.ts";
import {
  darePredicateFromScoutQl,
  dareResultFromScoutQl,
  dareValueFromScoutQl,
} from "#src/betting/dares/sql/dare-scoutql-expressions-v2.ts";
import {
  relationalScoutQlStatementFromImmutableAst,
  validateCanonicalDareScoutQl,
  type RelationalScoutQlCompilation,
} from "#src/reports/duckdb/relational-scoutql.ts";

function cteEntries(rootNode: AstObject): Map<string, AstObject> {
  const cteMap = astObject(rootNode["cte_map"], "a CTE map");
  return new Map(
    astArray(cteMap["map"], "CTE entries").map((entryValue) => {
      const entry = astObject(entryValue, "a CTE entry");
      const value = astObject(entry["value"], "a CTE definition");
      const query = astObject(value["query"], "a CTE query");
      return [
        astString(entry["key"], "a CTE name"),
        astObject(query["node"], "a CTE select node"),
      ];
    }),
  );
}

function targetBindingFromWhere(
  expression: RelationalScoutQlAstValue,
): { alias: string; target: string } | null {
  const object = astObject(expression, "a target predicate");
  if (expressionClass(object) !== "FUNCTION") return null;
  const fn = functionExpression(expression);
  if (fn.name !== "contains") return null;
  const targetFunction = fn.children[0];
  const columnExpression = fn.children[1];
  if (targetFunction === undefined || columnExpression === undefined)
    return null;
  const target = functionExpression(targetFunction);
  if (target.name !== "dare_target") return null;
  const column = astObject(columnExpression, "a target PUUID column");
  const names = astArray(column["column_names"], "a target PUUID column").map(
    (name) => astString(name, "a target PUUID column"),
  );
  if (names.length !== 2 || names[1] !== "puuid") return null;
  return {
    alias: names[0] ?? "",
    target: requiredStringArgument(target.children, 0, "dare_target"),
  };
}

function queuesFromWhere(
  expression: RelationalScoutQlAstValue,
): string[] | null {
  const object = astObject(expression, "a queue predicate");
  if (
    expressionClass(object) !== "OPERATOR" ||
    expressionType(object) !== "COMPARE_IN"
  ) {
    return null;
  }
  const children = astArray(object["children"], "queue values");
  const column = children[0];
  if (column === undefined) return null;
  const columnObject = astObject(column, "a queue column");
  const names = astArray(columnObject["column_names"], "a queue column").map(
    (name) => astString(name, "a queue column"),
  );
  if (names.length !== 2 || names[1] !== "queue") return null;
  return children.slice(1).map((child) => {
    const value = constantValue(child);
    if (typeof value !== "string") {
      throw new DareScoutQlProfileError("Queue values must be text literals.");
    }
    return value;
  });
}

function gameSetScope(candidateNode: AstObject): {
  targetKeys: string[];
  queues: DareGameSetV2["queues"];
} {
  const where = candidateNode["where_clause"];
  if (where === null || where === undefined) {
    throw new DareScoutQlProfileError(
      "Every game set must bind targets and queues.",
    );
  }
  const targetByAlias = new Map<string, string>();
  let queues: string[] | null = null;
  for (const clause of flattenAnd(where)) {
    const target = targetBindingFromWhere(clause);
    if (target !== null) {
      targetByAlias.set(target.alias, target.target);
      continue;
    }
    const clauseQueues = queuesFromWhere(clause);
    if (clauseQueues !== null) {
      queues = clauseQueues;
      continue;
    }
    throw new DareScoutQlProfileError(
      "Game-set WHERE may contain only target and queue bindings.",
    );
  }
  const targetKeys = [...targetByAlias.entries()]
    .toSorted(
      ([left], [right]) => Number(left.slice(1)) - Number(right.slice(1)),
    )
    .map((entry) => entry[1]);
  if (queues === null || targetKeys.length === 0) {
    throw new DareScoutQlProfileError(
      "Every game set must bind targets and queues.",
    );
  }
  return { targetKeys, queues: QueueTypeSchema.array().parse(queues) };
}

function collectJoinConditions(table: AstObject): RelationalScoutQlAstValue[] {
  if (astString(table["type"], "a FROM relation type") !== "JOIN") return [];
  const left = astObject(table["left"], "a JOIN left relation");
  const condition = table["condition"];
  if (condition === undefined || condition === null) {
    throw new DareScoutQlProfileError("Target joins require an ON condition.");
  }
  return [...collectJoinConditions(left), condition];
}

function relationshipForCandidate(
  candidateNode: AstObject,
  targetCount: number,
): DareGameSetV2["relationship"] {
  if (targetCount === 1) return "independent";
  const from = astObject(
    candidateNode["from_table"],
    "a game-set FROM relation",
  );
  const conditions = collectJoinConditions(from);
  if (conditions.length !== targetCount - 1) {
    throw new DareScoutQlProfileError(
      "Every additional target requires one match join.",
    );
  }
  const relationshipKinds = conditions.map((condition) => {
    const clauses = flattenAnd(condition);
    if (clauses.length === 1) return "same_match" as const;
    const teamClause = clauses[1];
    if (teamClause === undefined) {
      throw new DareScoutQlProfileError(
        "Target relationship join is incomplete.",
      );
    }
    const type = expressionType(astObject(teamClause, "a team relationship"));
    if (type === "COMPARE_EQUAL") return "same_team" as const;
    if (type === "COMPARE_NOTEQUAL") return "opponents" as const;
    throw new DareScoutQlProfileError("Unknown target team relationship.");
  });
  const relationship = relationshipKinds[0];
  if (
    relationship === undefined ||
    relationshipKinds.some((candidate) => candidate !== relationship)
  ) {
    throw new DareScoutQlProfileError(
      "All target joins must use the same relationship.",
    );
  }
  return relationship;
}

function gameSetFromCte(input: {
  name: string;
  candidateNode: AstObject;
  boundedNode: AstObject;
}): DareGameSetV2 {
  const scope = gameSetScope(input.candidateNode);
  const selectList = astArray(
    input.candidateNode["select_list"],
    "game-set outputs",
  );
  const matchedIndex = selectList.findIndex((expression) => {
    const object = astObject(expression, "a game-set output");
    return object["alias"] === "matched";
  });
  if (matchedIndex === -1) {
    throw new DareScoutQlProfileError(
      `Game set ${input.name} requires a matched output.`,
    );
  }
  const matched = selectList[matchedIndex];
  if (matched === undefined) {
    throw new DareScoutQlProfileError(
      `Game set ${input.name} has an invalid matched output.`,
    );
  }
  const projections = selectList.slice(matchedIndex + 1).map((expression) => {
    const object = astObject(expression, "a game-set projection");
    return {
      name: astString(object["alias"], "a projection alias"),
      value: dareValueFromScoutQl(expression, scope.targetKeys),
    };
  });
  return {
    name: input.name,
    targetKeys: scope.targetKeys,
    relationship: relationshipForCandidate(
      input.candidateNode,
      scope.targetKeys.length,
    ),
    queues: scope.queues,
    predicate: darePredicateFromScoutQl(matched, scope.targetKeys),
    projections,
    orderBy: "game_end_at_asc_match_id_asc",
    limit: limitFromNode(input.boundedNode, `Game set ${input.name}`),
  };
}

function planFromCompilation(
  compilation: RelationalScoutQlCompilation,
): DareCompiledPlanV2 {
  const statement = astObject(
    relationalScoutQlStatementFromImmutableAst(compilation.immutableAst),
    "a statement",
  );
  const root = astObject(statement["node"], "a SELECT statement");
  const ctes = cteEntries(root);
  const gameSets = [...ctes.entries()].flatMap(([name, candidateNode]) => {
    if (!name.endsWith("_candidates")) return [];
    const gameSetName = name.slice(0, -"_candidates".length);
    const boundedNode = ctes.get(gameSetName);
    if (boundedNode === undefined) {
      throw new DareScoutQlProfileError(
        `Game set ${gameSetName} is missing its bounded CTE.`,
      );
    }
    return [gameSetFromCte({ name: gameSetName, candidateNode, boundedNode })];
  });
  const eligible = ctes.get("eligible_matches");
  if (eligible === undefined) {
    throw new DareScoutQlProfileError(
      "Dare ScoutQL requires eligible_matches.",
    );
  }
  const output = astArray(root["select_list"], "the achieved output")[0];
  if (output === undefined) {
    throw new DareScoutQlProfileError(
      "Dare ScoutQL requires an achieved output.",
    );
  }
  return DareCompiledPlanV2Schema.parse({
    version: 2,
    gameSets,
    result: dareResultFromScoutQl(output),
    maxEligibleGames: limitFromNode(eligible, "eligible_matches"),
  });
}

export type DareScoutQlPlanCompilationV2 = RelationalScoutQlCompilation & {
  plan: DareCompiledPlanV2;
};

export type DareScoutQlPlanValidationV2 =
  | { kind: "valid"; compilation: DareScoutQlPlanCompilationV2 }
  | { kind: "invalid"; issues: string[] };

export async function compileDareScoutQlPlanV2(input: {
  queryText: string;
  targets: readonly DareTargetBindingV2[];
}): Promise<DareScoutQlPlanValidationV2> {
  const targetKeys = input.targets.map((target) => target.key);
  const relational = await validateCanonicalDareScoutQl({
    queryText: input.queryText,
    allowedTargetKeys: targetKeys,
  });
  if (relational.kind === "invalid") return relational;
  try {
    const plan = planFromCompilation(relational.compilation);
    const semanticIssues = darePlanSemanticIssues(plan, input.targets);
    if (semanticIssues.length > 0) {
      return { kind: "invalid", issues: semanticIssues };
    }
    const regenerated = await validateCanonicalDareScoutQl({
      queryText: formatDareScoutQlV2(plan),
      allowedTargetKeys: targetKeys,
    });
    if (regenerated.kind === "invalid") {
      throw new Error(
        `Dare ScoutQL formatter produced invalid output: ${regenerated.issues.join(" ")}`,
      );
    }
    if (regenerated.compilation.planHash !== relational.compilation.planHash) {
      return {
        kind: "invalid",
        issues: [
          "Dare ScoutQL uses a valid SQL construct outside the versioned contract profile. Format the generated contract query and edit only its Dare expressions.",
        ],
      };
    }
    return {
      kind: "valid",
      compilation: { ...relational.compilation, plan },
    };
  } catch (error) {
    if (error instanceof DareScoutQlProfileError) {
      return { kind: "invalid", issues: [error.message] };
    }
    // Surface the schema's own messages rather than one generic line: a domain
    // rejection ("MID" is not a team position) is only actionable if the
    // authoring loop is told which value was wrong and what is legal.
    if (error instanceof z.ZodError) {
      return {
        kind: "invalid",
        issues: error.issues.map((issue) => issue.message),
      };
    }
    throw error;
  }
}
