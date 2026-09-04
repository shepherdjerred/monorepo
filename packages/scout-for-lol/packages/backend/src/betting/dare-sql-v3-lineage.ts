import { relationalScoutQlStatementFromImmutableAst } from "#src/reports/duckdb/relational-scoutql.ts";
import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";
import { dareSqlV3SourceTargetsFromAst } from "#src/betting/dare-sql-v3-finality.ts";

export function dareSqlV3CteTargetDependencies(
  immutableAst: string,
  branch: string,
  targetKeys: readonly string[],
): string[] {
  const statement = objectValue(
    relationalScoutQlStatementFromImmutableAst(immutableAst),
  );
  const node = objectValue(statement?.["node"]);
  const entries = arrayValue(objectValue(node?.["cte_map"])?.["map"]);
  const ctes = new Map<string, JsonValue>();
  for (const value of entries) {
    const entry = objectValue(value);
    const name = stringValue(entry?.["key"]);
    if (name !== null) ctes.set(name, entry?.["value"] ?? null);
  }
  const dependencies = new Set<string>();
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const value = ctes.get(name);
    if (value === undefined) return;
    dareSqlV3SourceTargetsFromAst(value, new Set(targetKeys), dependencies);
    for (const candidate of ctes.keys()) {
      if (
        new RegExp(String.raw`\b${candidate}\b`, "iu").test(
          JSON.stringify(value),
        )
      ) {
        visit(candidate);
      }
    }
  };
  for (const name of ctes.keys()) {
    if (new RegExp(String.raw`\b${name}\b`, "iu").test(branch)) visit(name);
  }
  return [...dependencies].toSorted();
}
