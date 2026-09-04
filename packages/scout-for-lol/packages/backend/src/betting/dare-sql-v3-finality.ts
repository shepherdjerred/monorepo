import { relationalScoutQlStatementFromImmutableAst } from "#src/reports/duckdb/relational-scoutql.ts";
import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";

function nonnegativeIntegerConstant(value: JsonValue | undefined) {
  const expression = objectValue(value);
  const encoded = objectValue(expression?.["value"]);
  const raw = encoded?.["value"];
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? raw
    : null;
}

function isCount(value: JsonValue | undefined): boolean {
  const expression = objectValue(value);
  const name = stringValue(expression?.["function_name"]);
  return name === "count" || name === "count_star";
}

export function dareSqlV3SourceTargetsFromAst(
  value: JsonValue,
  targets: ReadonlySet<string>,
  found: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const child of value)
      dareSqlV3SourceTargetsFromAst(child, targets, found);
    return;
  }
  const object = objectValue(value);
  if (object === null) return;
  const table = stringValue(object["table_name"]);
  if (table !== null && targets.has(table)) found.add(table);
  for (const child of Object.values(object)) {
    dareSqlV3SourceTargetsFromAst(child, targets, found);
  }
}

function selectedColumnName(value: JsonValue): string | null {
  const expression = objectValue(value);
  if (expression === null) return null;
  const alias = stringValue(expression["alias"]);
  if (alias !== null && alias.length > 0) return alias.toLowerCase();
  const names = arrayValue(expression["column_names"]);
  return stringValue(names.at(-1))?.toLowerCase() ?? null;
}

function matchedColumn(value: JsonValue | undefined): boolean {
  const expression = objectValue(value);
  if (
    expression === null ||
    stringValue(expression["class"]) !== "COLUMN_REF"
  ) {
    return false;
  }
  const names = arrayValue(expression["column_names"]);
  return stringValue(names.at(-1))?.toLowerCase() === "matched";
}

function raceLaneForExists(value: JsonValue): string | null {
  const expression = objectValue(value);
  if (
    expression === null ||
    stringValue(expression["class"]) !== "SUBQUERY" ||
    stringValue(expression["subquery_type"]) !== "EXISTS"
  ) {
    return null;
  }
  const subquery = objectValue(expression["subquery"]);
  const node = objectValue(subquery?.["node"]);
  const from = objectValue(node?.["from_table"]);
  if (
    node === null ||
    from === null ||
    stringValue(node["type"]) !== "SELECT_NODE" ||
    stringValue(from["type"]) !== "BASE_TABLE" ||
    arrayValue(node["modifiers"]).length > 0 ||
    !matchedColumn(node["where_clause"])
  ) {
    return null;
  }
  return stringValue(from["table_name"]);
}

export function validateDareSqlV3RaceRootFromAst(
  immutableAst: string,
  laneGameSets: readonly string[],
): void {
  const statement = objectValue(
    relationalScoutQlStatementFromImmutableAst(immutableAst),
  );
  const node = objectValue(statement?.["node"]);
  const achieved = objectValue(arrayValue(node?.["select_list"])[0]);
  const branches = arrayValue(achieved?.["children"]);
  const lanes = branches.map((branch) => raceLaneForExists(branch));
  const expected = laneGameSets.toSorted((left, right) =>
    left.localeCompare(right),
  );
  if (
    achieved === null ||
    stringValue(achieved["class"]) !== "CONJUNCTION" ||
    stringValue(achieved["type"]) !== "CONJUNCTION_OR" ||
    lanes.includes(null) ||
    lanes
      .toSorted((left, right) => (left ?? "").localeCompare(right ?? ""))
      .join("|") !== expected.join("|")
  ) {
    throw new Error(
      "A race root must be exactly the OR of EXISTS checks for every declared lane's matched games.",
    );
  }
}

export function dareSqlV3ResultStructureFromAst(
  immutableAst: string,
  targetKeys: readonly string[],
) {
  const statement = objectValue(
    relationalScoutQlStatementFromImmutableAst(immutableAst),
  );
  const node = objectValue(statement?.["node"]);
  const cteMap = objectValue(node?.["cte_map"]);
  const gameSets = [];
  for (const entryValue of arrayValue(cteMap?.["map"])) {
    const entry = objectValue(entryValue);
    const name = stringValue(entry?.["key"]);
    const value = objectValue(entry?.["value"]);
    const query = objectValue(value?.["query"]);
    const cteNode = objectValue(query?.["node"]);
    if (name === null || cteNode === null) continue;
    const selected = arrayValue(cteNode["select_list"])
      .map((column) => selectedColumnName(column))
      .filter((column) => column !== null);
    if (!selected.includes("matched")) continue;
    if (!/^[a-z_]\w*$/u.test(name)) {
      throw new Error(
        "Dare SQL game-set CTE names must be simple identifiers.",
      );
    }
    if (!selected.includes("match_id") || !selected.includes("game_end_at"))
      continue;
    const required = new Set(["match_id", "game_end_at", "matched"]);
    const projectionColumns = selected.filter(
      (column) => !required.has(column),
    );
    if (projectionColumns.length !== new Set(projectionColumns).size) {
      throw new Error(`Dare SQL game set ${name} has duplicate projections.`);
    }
    const dependencies = new Set<string>();
    dareSqlV3SourceTargetsFromAst(
      entryValue,
      new Set(targetKeys),
      dependencies,
    );
    gameSets.push({
      name,
      projectionColumns,
      targetDependencies: [...dependencies].toSorted(),
    });
  }
  return { gameSets };
}

function directlyCountsAppendOnlyTargetRows(
  node: Record<string, JsonValue> | null,
): boolean {
  if (node === null || stringValue(node["type"]) !== "SELECT_NODE") {
    return false;
  }
  const from = objectValue(node["from_table"]);
  const cteMap = objectValue(node["cte_map"]);
  return (
    from !== null &&
    stringValue(from["type"]) === "BASE_TABLE" &&
    /^T[1-5]$/u.test(stringValue(from["table_name"]) ?? "") &&
    arrayValue(cteMap?.["map"]).length === 0 &&
    arrayValue(node["modifiers"]).length === 0 &&
    node["where_clause"] === null &&
    arrayValue(node["group_expressions"]).length === 0 &&
    arrayValue(node["group_sets"]).length === 0 &&
    node["having"] === null &&
    node["sample"] === null &&
    node["qualify"] === null
  );
}

/** A deliberately narrow proof: COUNT can only increase as evidence grows. */
export function dareSqlV3FinalityFromAst(
  immutableAst: string,
): "monotone_true" | "deadline_only" {
  const statement = objectValue(
    relationalScoutQlStatementFromImmutableAst(immutableAst),
  );
  const node = objectValue(statement?.["node"]);
  const achieved = objectValue(arrayValue(node?.["select_list"])[0]);
  if (achieved === null || !isCount(achieved["left"])) {
    return "deadline_only";
  }
  const threshold = nonnegativeIntegerConstant(achieved["right"]);
  const comparison = stringValue(achieved["type"]);
  const proven =
    directlyCountsAppendOnlyTargetRows(node) &&
    ((comparison === "COMPARE_GREATERTHAN" && threshold !== null) ||
      (comparison === "COMPARE_GREATERTHANOREQUALTO" &&
        threshold !== null &&
        threshold > 0));
  return proven ? "monotone_true" : "deadline_only";
}
