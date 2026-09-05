import {
  DareAggregateFunctionV2Schema,
  DareParticipantRateFieldV2Schema,
  DareParticipantValueFieldV2Schema,
  DareResultOperatorV2Schema,
  type DareBooleanExpressionV2,
  type DareResultExpressionV2,
  type DareValueV2,
} from "@scout-for-lol/data";
import {
  astArray,
  astObject,
  astString,
  constantValue,
  DareScoutQlProfileError,
  expressionClass,
  expressionType,
  functionExpression,
  nullableNumberArgument,
  nullableStringArgument,
  requiredNumberArgument,
  requiredStringArgument,
  type AstObject,
  type RelationalScoutQlAstValue,
} from "#src/betting/dares/sql/dare-scoutql-ast-v2.ts";

function targetForAlias(alias: string, targetKeys: readonly string[]): string {
  const match = /^p(\d+)$/.exec(alias);
  const indexText = match?.[1];
  if (indexText === undefined) {
    throw new DareScoutQlProfileError(`Unknown participant alias ${alias}.`);
  }
  const target = targetKeys[Number(indexText)];
  if (target === undefined) {
    throw new DareScoutQlProfileError(
      `Participant alias ${alias} has no target binding.`,
    );
  }
  return target;
}

function columnValue(
  expression: AstObject,
  targetKeys: readonly string[],
): DareValueV2 {
  const names = astArray(
    expression["column_names"],
    "qualified column names",
  ).map((name) => astString(name, "a qualified column name"));
  if (names.length !== 2) {
    throw new DareScoutQlProfileError("Dare value columns must be qualified.");
  }
  const alias = names[0] ?? "";
  const field = names[1] ?? "";
  if (field === "game_duration_seconds") {
    return { kind: "game", field: "duration_seconds" };
  }
  if (field === "queue") return { kind: "game", field: "queue" };
  return {
    kind: "participant",
    target: targetForAlias(alias, targetKeys),
    field: DareParticipantValueFieldV2Schema.parse(field),
  };
}

function relatedParticipantValue(
  children: readonly RelationalScoutQlAstValue[],
): DareValueV2 {
  const relationship = requiredStringArgument(
    children,
    1,
    "dare_related_participant_count",
  );
  if (relationship !== "ally" && relationship !== "opponent") {
    throw new DareScoutQlProfileError(
      "dare_related_participant_count relationship must be ally or opponent.",
    );
  }
  return {
    kind: "related_participant_count",
    target: requiredStringArgument(
      children,
      0,
      "dare_related_participant_count",
    ),
    relationship,
    championName: nullableStringArgument(
      children,
      2,
      "dare_related_participant_count",
    ),
  };
}

function timelineRole(
  children: readonly RelationalScoutQlAstValue[],
): "subject" | "killer" | "victim" | "assist" | "creator" | null {
  const role = nullableStringArgument(children, 2, "dare_timeline_event_count");
  if (
    role === null ||
    role === "subject" ||
    role === "killer" ||
    role === "victim" ||
    role === "assist" ||
    role === "creator"
  ) {
    return role;
  }
  throw new DareScoutQlProfileError("Unknown timeline participant role.");
}

function timelineValue(
  children: readonly RelationalScoutQlAstValue[],
): DareValueV2 {
  return {
    kind: "timeline_event_count",
    eventType: requiredStringArgument(children, 0, "dare_timeline_event_count"),
    target: nullableStringArgument(children, 1, "dare_timeline_event_count"),
    role: timelineRole(children),
    afterMs: nullableNumberArgument(children, 3, "dare_timeline_event_count"),
    beforeMs: nullableNumberArgument(children, 4, "dare_timeline_event_count"),
    itemId: nullableNumberArgument(children, 5, "dare_timeline_event_count"),
    // Appended, never inserted: the macro is positional, so shifting an existing
    // argument would change the canonical text of every stored contract and
    // break its plan-hash round-trip.
    monsterType: nullableStringArgument(
      children,
      6,
      "dare_timeline_event_count",
    ),
    buildingType: nullableStringArgument(
      children,
      7,
      "dare_timeline_event_count",
    ),
  };
}

function arithmeticOperator(
  functionName: string,
): "add" | "subtract" | "multiply" | "divide" | undefined {
  if (functionName === "+") return "add";
  if (functionName === "-") return "subtract";
  if (functionName === "*") return "multiply";
  if (functionName === "/") return "divide";
  return undefined;
}

function divisionRightOperand(
  expression: RelationalScoutQlAstValue,
): RelationalScoutQlAstValue {
  const nullIf = functionExpression(expression);
  const operand = nullIf.children[0];
  const zero = nullIf.children[1];
  if (
    operand === undefined ||
    zero === undefined ||
    nullIf.children.length !== 2 ||
    nullIf.name.toLowerCase() !== "nullif" ||
    constantValue(zero) !== 0
  ) {
    throw new DareScoutQlProfileError(
      "Dare division requires the canonical NULLIF(right, 0) denominator.",
    );
  }
  return operand;
}

export function dareValueFromScoutQl(
  expression: RelationalScoutQlAstValue,
  targetKeys: readonly string[],
): DareValueV2 {
  const object = astObject(expression, "a Dare value expression");
  if (expressionClass(object) === "COLUMN_REF") {
    return columnValue(object, targetKeys);
  }
  const fn = functionExpression(expression);
  if (fn.name === "dare_rate") {
    return {
      kind: "participant_rate",
      target: requiredStringArgument(fn.children, 0, fn.name),
      field: DareParticipantRateFieldV2Schema.parse(
        requiredStringArgument(fn.children, 1, fn.name),
      ),
    };
  }
  if (fn.name === "dare_related_participant_count") {
    return relatedParticipantValue(fn.children);
  }
  if (fn.name === "dare_timeline_event_count") {
    return timelineValue(fn.children);
  }
  const arithmetic = arithmeticOperator(fn.name);
  const left = fn.children[0];
  const right = fn.children[1];
  if (arithmetic === undefined || left === undefined || right === undefined) {
    throw new DareScoutQlProfileError(
      `Unsupported Dare value function ${fn.name}.`,
    );
  }
  return {
    kind: "arithmetic",
    operator: arithmetic,
    left: dareValueFromScoutQl(left, targetKeys),
    right: dareValueFromScoutQl(
      arithmetic === "divide" ? divisionRightOperand(right) : right,
      targetKeys,
    ),
  };
}

function comparisonOperator(
  type: string,
): "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | undefined {
  if (type === "COMPARE_EQUAL") return "eq";
  if (type === "COMPARE_NOTEQUAL") return "neq";
  if (type === "COMPARE_GREATERTHANOREQUALTO") return "gte";
  if (type === "COMPARE_LESSTHANOREQUALTO") return "lte";
  if (type === "COMPARE_GREATERTHAN") return "gt";
  if (type === "COMPARE_LESSTHAN") return "lt";
  return undefined;
}

function conjunctionKind(object: AstObject): "and" | "or" | null {
  const type = expressionType(object);
  if (type === "CONJUNCTION_AND") return "and";
  if (type === "CONJUNCTION_OR") return "or";
  return null;
}

export function darePredicateFromScoutQl(
  expression: RelationalScoutQlAstValue,
  targetKeys: readonly string[],
): DareBooleanExpressionV2 {
  const object = astObject(expression, "a Dare predicate");
  const className = expressionClass(object);
  if (className === "COMPARISON") {
    const operator = comparisonOperator(expressionType(object));
    if (operator === undefined) {
      throw new DareScoutQlProfileError(
        "Unsupported Dare comparison operator.",
      );
    }
    const threshold = constantValue(object["right"]);
    if (threshold === null) {
      throw new DareScoutQlProfileError(
        "Dare comparison thresholds cannot be null.",
      );
    }
    return {
      kind: "comparison",
      value: dareValueFromScoutQl(object["left"], targetKeys),
      operator,
      threshold,
    };
  }
  if (className === "CONJUNCTION") {
    const kind = conjunctionKind(object);
    if (kind === null) {
      throw new DareScoutQlProfileError(
        "Unsupported Dare Boolean conjunction.",
      );
    }
    return {
      kind,
      operands: astArray(object["children"], "Boolean operands").map(
        (operand) => darePredicateFromScoutQl(operand, targetKeys),
      ),
    };
  }
  if (className === "OPERATOR" && expressionType(object) === "OPERATOR_NOT") {
    const operand = astArray(object["children"], "NOT operands")[0];
    if (operand === undefined) {
      throw new DareScoutQlProfileError("NOT requires one operand.");
    }
    return {
      kind: "not",
      operand: darePredicateFromScoutQl(operand, targetKeys),
    };
  }
  throw new DareScoutQlProfileError("Unsupported Dare predicate expression.");
}

function resultLeaf(
  expression: RelationalScoutQlAstValue,
): DareResultExpressionV2 {
  const fn = functionExpression(expression);
  if (fn.name === "dare_matching_games") {
    return {
      kind: "matching_games",
      gameSet: requiredStringArgument(fn.children, 0, fn.name),
      operator: DareResultOperatorV2Schema.parse(
        requiredStringArgument(fn.children, 1, fn.name),
      ),
      threshold: requiredNumberArgument(fn.children, 2, fn.name),
    };
  }
  if (fn.name === "dare_aggregate") {
    return {
      kind: "aggregate",
      gameSet: requiredStringArgument(fn.children, 0, fn.name),
      projection: requiredStringArgument(fn.children, 1, fn.name),
      function: DareAggregateFunctionV2Schema.parse(
        requiredStringArgument(fn.children, 2, fn.name),
      ),
      operator: DareResultOperatorV2Schema.parse(
        requiredStringArgument(fn.children, 3, fn.name),
      ),
      threshold: requiredNumberArgument(fn.children, 4, fn.name),
    };
  }
  throw new DareScoutQlProfileError(
    `Unsupported Dare result function ${fn.name}.`,
  );
}

export function dareResultFromScoutQl(
  expression: RelationalScoutQlAstValue,
): DareResultExpressionV2 {
  const object = astObject(expression, "a Dare result expression");
  const className = expressionClass(object);
  if (className === "FUNCTION") return resultLeaf(expression);
  if (className === "CONJUNCTION") {
    const kind = conjunctionKind(object);
    if (kind === null) {
      throw new DareScoutQlProfileError("Unsupported Dare result conjunction.");
    }
    return {
      kind,
      operands: astArray(object["children"], "result operands").map((operand) =>
        dareResultFromScoutQl(operand),
      ),
    };
  }
  if (className === "OPERATOR" && expressionType(object) === "OPERATOR_NOT") {
    const operand = astArray(object["children"], "NOT operands")[0];
    if (operand === undefined) {
      throw new DareScoutQlProfileError("NOT requires one result operand.");
    }
    return { kind: "not", operand: dareResultFromScoutQl(operand) };
  }
  throw new DareScoutQlProfileError("Unsupported Dare result expression.");
}
