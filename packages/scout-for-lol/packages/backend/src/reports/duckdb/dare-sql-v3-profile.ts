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
  "row_number",
  "sum",
  "upper",
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
  if (stringValue(object["type"]) === "SELECT_NODE") {
    const hasLimit = arrayValue(object["modifiers"]).some((modifierValue) => {
      const modifier = objectValue(modifierValue);
      return (
        modifier !== null && stringValue(modifier["type"]) === "LIMIT_MODIFIER"
      );
    });
    if (hasLimit) {
      const columns = orderedColumns(object);
      if (!columns.has("game_end_at") || !columns.has("match_id")) {
        issues.push(
          "Every Dare SQL LIMIT must be ordered by game_end_at and match_id.",
        );
      }
    }
  }
  const functionName = stringValue(object["function_name"]);
  if (functionName === "row_number") {
    issues.push(
      "Dare SQL row_number is not permitted because its window ordering cannot be proven deterministic.",
    );
  }
  if (functionName === "/") {
    const denominator = objectValue(arrayValue(object["children"])[1]);
    if (stringValue(denominator?.["function_name"]) !== "nullif") {
      issues.push(
        "Dare SQL division must use NULLIF(denominator, 0) so division by zero is NULL.",
      );
    }
  }
  for (const child of Object.values(object)) {
    appendDareSqlV3DeterminismIssues(child, issues);
  }
}
