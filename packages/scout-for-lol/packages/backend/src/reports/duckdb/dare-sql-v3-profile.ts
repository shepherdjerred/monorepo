import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";

export const DARE_SQL_V3_SOURCES = new Set([
  "matches",
  "match_participants",
  "match_teams",
  "match_team_bans",
  "timeline_events",
  "timeline_event_participants",
  "timeline_participant_frames",
  "timeline_coverage",
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
]);

export const DARE_SQL_V3_FUNCTIONS = new Set([
  "+",
  "-",
  "*",
  "/",
  "abs",
  "avg",
  "ceil",
  "coalesce",
  "contains",
  "count",
  "count_star",
  "floor",
  "greatest",
  "least",
  "length",
  "lower",
  "max",
  "min",
  "nullif",
  "round",
  "sum",
  "upper",
]);

const DARE_SQL_V3_UNIQUE_ORDERING_COLUMNS: ReadonlyMap<
  string,
  readonly string[]
> = new Map([
  ["matches", ["match_id"]],
  ["match_participants", ["puuid"]],
  ["match_teams", ["team_id"]],
  ["match_team_bans", ["team_id", "pick_turn"]],
  ["timeline_events", ["event_id"]],
  [
    "timeline_event_participants",
    ["event_id", "participant_id", "role", "role_index"],
  ],
  ["timeline_participant_frames", ["frame_index", "participant_id"]],
  ["timeline_coverage", []],
  ["T1", ["puuid"]],
  ["T2", ["puuid"]],
  ["T3", ["puuid"]],
  ["T4", ["puuid"]],
  ["T5", ["puuid"]],
]);

function orderedColumns(node: Record<string, JsonValue>): Set<string> {
  const names = new Set<string>();
  for (const modifierValue of arrayValue(node["modifiers"])) {
    const modifier = objectValue(modifierValue);
    if (
      modifier === null ||
      stringValue(modifier["type"]) !== "ORDER_MODIFIER"
    ) {
      continue;
    }
    for (const orderValue of arrayValue(modifier["orders"])) {
      const order = objectValue(orderValue);
      const expression =
        order === null ? null : objectValue(order["expression"]);
      for (const columnValue of arrayValue(expression?.["column_names"])) {
        const column = stringValue(columnValue);
        if (column !== null) names.add(column.toLowerCase());
      }
    }
  }
  return names;
}

function baseTableNames(value: JsonValue): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((child) => baseTableNames(child));
  }
  const object = objectValue(value);
  if (object === null) return [];
  if (stringValue(object["type"]) === "BASE_TABLE") {
    const table = stringValue(object["table_name"]);
    return table === null ? [] : [table];
  }
  return Object.values(object).flatMap((child) => baseTableNames(child));
}

function missingUniqueOrderingColumns(
  object: Record<string, JsonValue>,
  columns: ReadonlySet<string>,
): string[] {
  const fromTable = objectValue(object["from_table"]);
  if (fromTable === null) return [];
  const required = new Set<string>();
  for (const table of baseTableNames(fromTable)) {
    for (const column of DARE_SQL_V3_UNIQUE_ORDERING_COLUMNS.get(table) ?? []) {
      required.add(column);
    }
  }
  return [...required].filter((column) => !columns.has(column));
}

export function appendDareSqlV3DeterminismIssues(
  value: JsonValue,
  issues: string[],
): void {
  if (Array.isArray(value)) {
    for (const child of value) appendDareSqlV3DeterminismIssues(child, issues);
    return;
  }
  const object = objectValue(value);
  if (object === null) return;
  if (object["sample"] !== null && object["sample"] !== undefined) {
    issues.push("Dare SQL sampling is not deterministic and is not supported.");
  }
  if (stringValue(object["type"]) === "SELECT_NODE") {
    appendSelectDeterminismIssues(object, issues);
  }
  const functionName = stringValue(object["function_name"]);
  if (functionName === "/") {
    appendDivisionDeterminismIssue(object, issues);
  }
  if (functionName === "*") {
    appendIntegerArithmeticIssue(object, issues);
  }
  for (const child of Object.values(object)) {
    appendDareSqlV3DeterminismIssues(child, issues);
  }
}

function appendIntegerArithmeticIssue(
  object: Record<string, JsonValue>,
  issues: string[],
): void {
  const children = arrayValue(object["children"]);
  if (children.length !== 2) return;
  const hasIntegerConstant = children.some((child) => {
    const constant = objectValue(child);
    if (constant === null || stringValue(constant["class"]) !== "CONSTANT") {
      return false;
    }
    const value = objectValue(constant["value"]);
    const type = value === null ? null : objectValue(value["type"]);
    return stringValue(type?.["id"]) === "INTEGER";
  });
  const hasNonConstant = children.some((child) => {
    const value = objectValue(child);
    return value !== null && stringValue(value["class"]) !== "CONSTANT";
  });
  if (hasIntegerConstant && hasNonConstant) {
    issues.push(
      "Dare SQL integer multiplication must use a decimal literal to widen operands safely.",
    );
  }
}

function appendSelectDeterminismIssues(
  object: Record<string, JsonValue>,
  issues: string[],
): void {
  if (object["sample"] !== null && object["sample"] !== undefined) {
    issues.push("Dare SQL sampling is not deterministic and is not supported.");
  }
  const hasLimit = arrayValue(object["modifiers"]).some((modifierValue) => {
    const modifier = objectValue(modifierValue);
    return (
      modifier !== null && stringValue(modifier["type"]) === "LIMIT_MODIFIER"
    );
  });
  if (!hasLimit) return;
  const columns = orderedColumns(object);
  if (!columns.has("game_end_at") || !columns.has("match_id")) {
    issues.push(
      "Every Dare SQL LIMIT must be ordered by game_end_at and match_id.",
    );
  }
  const missingUniqueColumns = missingUniqueOrderingColumns(object, columns);
  if (missingUniqueColumns.length > 0) {
    issues.push(
      `Every Dare SQL LIMIT must include unique ordering columns: ${missingUniqueColumns.join(", ")}.`,
    );
  }
}

function appendDivisionDeterminismIssue(
  object: Record<string, JsonValue>,
  issues: string[],
): void {
  const denominator = objectValue(arrayValue(object["children"])[1]);
  if (stringValue(denominator?.["function_name"]) !== "nullif") {
    issues.push(
      "Dare SQL division must use NULLIF(denominator, 0) so division by zero is NULL.",
    );
  }
}
