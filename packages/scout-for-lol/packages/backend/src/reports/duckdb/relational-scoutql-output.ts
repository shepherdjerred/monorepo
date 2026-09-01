import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";

type ExpressionKind = "boolean" | "null" | "other";

function constantExpressionKind(
  object: Record<string, JsonValue>,
): ExpressionKind {
  const value = objectValue(object["value"]);
  const type = value === null ? null : objectValue(value["type"]);
  const typeId = type === null ? null : stringValue(type["id"]);
  if (typeId === "BOOLEAN") return "boolean";
  return typeId === "NULL" ? "null" : "other";
}

function caseExpressionKind(object: Record<string, JsonValue>): ExpressionKind {
  const branches = arrayValue(object["case_checks"]).map((value) => {
    const branch = objectValue(value);
    return branch === null
      ? "other"
      : expressionKind(objectValue(branch["then_expr"]));
  });
  branches.push(expressionKind(objectValue(object["else_expr"])));
  return branches.includes("boolean") &&
    branches.every((kind) => kind === "boolean" || kind === "null")
    ? "boolean"
    : "other";
}

function expressionKind(
  object: Record<string, JsonValue> | null,
): ExpressionKind {
  if (object === null) return "other";
  const expressionClass = stringValue(object["class"]);
  if (expressionClass === "COMPARISON" || expressionClass === "CONJUNCTION") {
    return "boolean";
  }
  if (expressionClass === "CONSTANT") return constantExpressionKind(object);
  if (expressionClass === "CASE") return caseExpressionKind(object);
  if (expressionClass === "SUBQUERY") {
    return stringValue(object["subquery_type"]) === "EXISTS"
      ? "boolean"
      : "other";
  }
  if (expressionClass === "CAST") {
    const castType = objectValue(object["cast_type"]);
    return castType !== null && stringValue(castType["id"]) === "BOOLEAN"
      ? "boolean"
      : "other";
  }
  if (expressionClass === "FUNCTION") {
    return stringValue(object["function_name"]) === "contains"
      ? "boolean"
      : "other";
  }
  return stringValue(object["type"]) === "OPERATOR_NOT" ? "boolean" : "other";
}

export function relationalScoutQlOutputIssues(statement: JsonValue): string[] {
  const statementObject = objectValue(statement);
  const node =
    statementObject === null ? null : objectValue(statementObject["node"]);
  if (node === null || stringValue(node["type"]) !== "SELECT_NODE") {
    return ["Relational ScoutQL must contain one SELECT statement."];
  }
  const selectList = arrayValue(node["select_list"]);
  if (selectList.length !== 1) {
    return ["A Dare contract query must return exactly one achieved column."];
  }
  const output = objectValue(selectList[0]);
  if (output === null || stringValue(output["alias"]) !== "achieved") {
    return ["A Dare contract query must return one column aliased achieved."];
  }
  if (expressionKind(output) !== "boolean") {
    return [
      "A Dare contract query must return achieved as a Boolean expression.",
    ];
  }
  return [];
}
