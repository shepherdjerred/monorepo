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

function containsSubquery(value: JsonValue | undefined): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => containsSubquery(child));
  }
  const object = objectValue(value);
  if (object === null) return false;
  const expressionClass = stringValue(object["class"]);
  const expressionType = stringValue(object["type"]);
  if (expressionClass === "SUBQUERY" || expressionType === "SUBQUERY") {
    return true;
  }
  return Object.entries(object).some(
    ([key, child]) =>
      key.toLowerCase().includes("subquery") || containsSubquery(child),
  );
}

function containsFilter(value: JsonValue | undefined): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => containsFilter(child));
  }
  const object = objectValue(value);
  if (object === null) return false;
  if (
    Object.entries(object).some(
      ([key, child]) => key.toLowerCase() === "filter" && child !== null,
    )
  ) {
    return true;
  }
  return Object.values(object).some((child) => containsFilter(child));
}

function sourceTargets(
  value: JsonValue,
  targets: ReadonlySet<string>,
  found: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const child of value) sourceTargets(child, targets, found);
    return;
  }
  const object = objectValue(value);
  if (object === null) return;
  const table = stringValue(object["table_name"]);
  if (table !== null && targets.has(table)) found.add(table);
  for (const child of Object.values(object)) {
    sourceTargets(child, targets, found);
  }
}

function sourceCtes(
  value: JsonValue,
  cteNames: ReadonlySet<string>,
  found: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const child of value) sourceCtes(child, cteNames, found);
    return;
  }
  const object = objectValue(value);
  if (object === null) return;
  const table = stringValue(object["table_name"]);
  if (table !== null && cteNames.has(table)) found.add(table);
  for (const child of Object.values(object)) sourceCtes(child, cteNames, found);
}

/** Resolve each CTE's target lineage, including CTEs referenced by CTEs. */
export function dareSqlV3CteTargetDependenciesFromAst(
  immutableAst: string,
  targetKeys: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const statement = objectValue(
    relationalScoutQlStatementFromImmutableAst(immutableAst),
  );
  const node = objectValue(statement?.["node"]);
  const cteMap = objectValue(node?.["cte_map"]);
  const entries: { name: string; value: Record<string, JsonValue> }[] = [];
  for (const entryValue of arrayValue(cteMap?.["map"])) {
    const entry = objectValue(entryValue);
    const name = stringValue(entry?.["key"]);
    const value = objectValue(entry?.["value"]);
    if (name !== null && value !== null) entries.push({ name, value });
  }
  const names = new Set(entries.map((entry) => entry.name));
  const direct = new Map<string, Set<string>>();
  const references = new Map<string, Set<string>>();
  for (const entry of entries) {
    const targets = new Set<string>();
    sourceTargets(entry.value, new Set(targetKeys), targets);
    direct.set(entry.name, targets);
    const ctes = new Set<string>();
    sourceCtes(entry.value, names, ctes);
    references.set(entry.name, ctes);
  }
  const resolved = new Map<string, readonly string[]>();
  const visiting = new Set<string>();
  const resolve = (name: string): readonly string[] => {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;
    if (visiting.has(name)) return [];
    visiting.add(name);
    const values = new Set(direct.get(name));
    for (const reference of references.get(name) ?? []) {
      for (const target of resolve(reference)) values.add(target);
    }
    visiting.delete(name);
    const result = [...values].toSorted();
    resolved.set(name, result);
    return result;
  };
  for (const name of names) resolve(name);
  return resolved;
}

function selectedColumnName(value: JsonValue): string | null {
  const expression = objectValue(value);
  if (expression === null) return null;
  const alias = stringValue(expression["alias"]);
  if (alias !== null && alias.length > 0) return alias.toLowerCase();
  const names = arrayValue(expression["column_names"]);
  return stringValue(names.at(-1))?.toLowerCase() ?? null;
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
    sourceTargets(entryValue, new Set(targetKeys), dependencies);
    gameSets.push({
      name,
      projectionColumns,
      targetDependencies: [...dependencies].toSorted(),
    });
  }
  return { gameSets };
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
  // CTEs can derive row predicates from aggregates over the full target
  // history. A later game may therefore change whether an earlier row is
  // counted, so proving COUNT itself is increasing is insufficient.
  const cteMap = objectValue(node?.["cte_map"]);
  if (arrayValue(cteMap?.["map"]).length > 0) {
    return "deadline_only";
  }
  // A correlated or scalar subquery can change the predicate as later games
  // arrive (for example, comparing each game to the current AVG). Such a
  // count is not append-monotone even though COUNT itself is increasing.
  if (containsSubquery(node)) {
    return "deadline_only";
  }
  // FILTER predicates are part of the counted relation. Without a separate
  // append-monotonicity proof, a later row can change that predicate (or its
  // NULL semantics), so defer settlement to the deadline.
  if (containsFilter(achieved["left"])) {
    return "deadline_only";
  }
  const threshold = nonnegativeIntegerConstant(achieved["right"]);
  const comparison = stringValue(achieved["type"]);
  const proven =
    (comparison === "COMPARE_GREATERTHAN" && threshold !== null) ||
    (comparison === "COMPARE_GREATERTHANOREQUALTO" &&
      threshold !== null &&
      threshold > 0);
  return proven ? "monotone_true" : "deadline_only";
}
