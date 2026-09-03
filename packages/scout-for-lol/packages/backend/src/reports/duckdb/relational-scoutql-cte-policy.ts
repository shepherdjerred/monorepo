import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";

function cteDefinitions(statement: JsonValue): Map<string, JsonValue> {
  const statementObject = objectValue(statement);
  const node =
    statementObject === null ? null : objectValue(statementObject["node"]);
  const cteMap = node === null ? null : objectValue(node["cte_map"]);
  const definitions = new Map<string, JsonValue>();
  if (cteMap === null) return definitions;
  for (const entryValue of arrayValue(cteMap["map"])) {
    const entry = objectValue(entryValue);
    if (entry === null) continue;
    const name = stringValue(entry["key"]);
    const value = entry["value"];
    if (name !== null && value !== undefined) definitions.set(name, value);
  }
  return definitions;
}

function referencedCtes(
  value: JsonValue,
  names: ReadonlySet<string>,
): Set<string> {
  const references = new Set<string>();
  function visit(current: JsonValue): void {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    const object = objectValue(current);
    if (object === null) return;
    if (stringValue(object["type"]) === "BASE_TABLE") {
      const table = stringValue(object["table_name"]);
      const catalog = stringValue(object["catalog_name"]) ?? "";
      const schema = stringValue(object["schema_name"]) ?? "";
      if (
        table !== null &&
        catalog.length === 0 &&
        schema.length === 0 &&
        names.has(table)
      ) {
        references.add(table);
      }
    }
    for (const [key, child] of Object.entries(object)) {
      if (key !== "cte_map") visit(child);
    }
  }
  visit(value);
  return references;
}

function hasTargetRelation(
  value: JsonValue,
  allowedTargetKeys: ReadonlySet<string>,
): boolean {
  if (Array.isArray(value))
    return value.some((item) => hasTargetRelation(item, allowedTargetKeys));
  const object = objectValue(value);
  if (object === null) return false;
  if (stringValue(object["type"]) === "BASE_TABLE") {
    const table = stringValue(object["table_name"]);
    const catalog = stringValue(object["catalog_name"]) ?? "";
    const schema = stringValue(object["schema_name"]) ?? "";
    if (
      table !== null &&
      catalog.length === 0 &&
      schema.length === 0 &&
      /^T[1-5]$/u.test(table)
    ) {
      return allowedTargetKeys.has(table);
    }
  }
  return Object.values(object).some((child) =>
    hasTargetRelation(child, allowedTargetKeys),
  );
}

export function appendUnreachableTargetCteIssues(
  statement: JsonValue,
  allowedTargetKeys: ReadonlySet<string>,
  issues: string[],
): void {
  const definitions = cteDefinitions(statement);
  if (definitions.size === 0) return;
  const statementObject = objectValue(statement);
  const node =
    statementObject === null ? null : objectValue(statementObject["node"]);
  if (node === null) return;
  const names = new Set(definitions.keys());
  const reachable = new Set<string>();
  const pending = [...referencedCtes(node, names)];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || reachable.has(name)) continue;
    reachable.add(name);
    const definition = definitions.get(name);
    if (definition === undefined) continue;
    for (const reference of referencedCtes(definition, names)) {
      if (!reachable.has(reference)) pending.push(reference);
    }
  }
  const hasUnreachableTarget = [...definitions.entries()].some(
    ([name, definition]) =>
      !reachable.has(name) && hasTargetRelation(definition, allowedTargetKeys),
  );
  if (hasUnreachableTarget) {
    issues.push(
      "Dare SQL target relations must be reachable from the root query.",
    );
  }
}
