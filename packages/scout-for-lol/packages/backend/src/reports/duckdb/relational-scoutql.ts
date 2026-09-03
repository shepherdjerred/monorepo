import { z } from "zod";
import { DARE_V2_MAX_QUERY_LENGTH } from "@scout-for-lol/data";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";
import {
  CANONICAL_DARE_SCOUTQL_LIMITS,
  RAW_RELATIONAL_SCOUTQL_LIMITS,
  type RelationalScoutQlComplexityLimits,
} from "#src/reports/duckdb/relational-scoutql-limits.ts";
import { relationalScoutQlOutputIssues } from "#src/reports/duckdb/relational-scoutql-output.ts";
import {
  appendDareSqlV3DeterminismIssues,
  DARE_SQL_V3_FUNCTIONS,
  DARE_SQL_V3_SOURCES,
} from "#src/reports/duckdb/dare-sql-v3-profile.ts";
import {
  appendRelationalScoutQlCatalogIssues,
  appendRelationalScoutQlLimitIssues,
} from "#src/reports/duckdb/relational-scoutql-policy.ts";
import {
  appendTargetBindingIssues,
  appendTimelineCoverageIssues,
  appendWallClockIssues,
} from "#src/reports/duckdb/relational-scoutql-target-policy.ts";

const RELATIONAL_SCOUTQL_SOURCES = new Set([
  "match_participants",
  "match_teams",
  "timeline_events",
  "timeline_event_participants",
  "timeline_participant_frames",
  "timeline_coverage",
]);

const RELATIONAL_SCOUTQL_FUNCTIONS = new Set([
  "+",
  "-",
  "*",
  "/",
  "avg",
  "contains",
  "count",
  "count_star",
  "dare_aggregate",
  "dare_matching_games",
  "dare_rate",
  "dare_related_participant_count",
  "dare_target",
  "dare_timeline_event_count",
  "greatest",
  "max",
  "min",
  "nullif",
  "sum",
]);

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const SerializedSqlSchema = z
  .object({
    error: z.boolean(),
    error_message: z.string().optional(),
    statements: z.array(JsonValueSchema).optional(),
  })
  .loose();

const AstRowSchema = z.object({ ast: z.string() });
const CanonicalRowSchema = z.object({ sql: z.string() });

type AstFacts = {
  cteNames: Set<string>;
  functions: string[];
  physicalSources: string[];
  targetKeys: string[];
  cteCount: number;
  joinedRelations: number;
  predicates: number;
  maxExpressionDepth: number;
  recursive: boolean;
  wallClockReferences: string[];
  invalidTargetCalls: number;
};

export type RelationalScoutQlFacts = {
  cteCount: number;
  joinedRelations: number;
  predicates: number;
  maxExpressionDepth: number;
  physicalSources: string[];
  functions: string[];
  targetKeys: string[];
};

export type RelationalScoutQlCompilation = {
  canonicalScoutQl: string;
  immutableAst: string;
  planHash: string;
  facts: RelationalScoutQlFacts;
};

export type RelationalScoutQlValidation =
  | { kind: "valid"; compilation: RelationalScoutQlCompilation }
  | { kind: "invalid"; issues: string[] };

export function relationalScoutQlStatementFromImmutableAst(
  immutableAst: string,
): JsonValue {
  const parsedJson: unknown = JSON.parse(immutableAst);
  const envelope = SerializedSqlSchema.parse(parsedJson);
  if (envelope.error) {
    throw new Error(
      "Immutable relational ScoutQL AST contains a parser error.",
    );
  }
  const statements = envelope.statements ?? [];
  const statement = statements[0];
  if (statement === undefined || statements.length !== 1) {
    throw new Error(
      "Immutable relational ScoutQL AST must contain one statement.",
    );
  }
  return statement;
}
function collectCteNames(value: JsonValue, facts: AstFacts): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCteNames(item, facts);
    return;
  }
  const object = objectValue(value);
  if (object === null) return;
  const cteMap = objectValue(object["cte_map"]);
  if (cteMap !== null) {
    for (const entryValue of arrayValue(cteMap["map"])) {
      const entry = objectValue(entryValue);
      const name = entry === null ? null : stringValue(entry["key"]);
      if (name !== null) {
        facts.cteNames.add(name);
        facts.cteCount += 1;
      }
    }
  }
  for (const child of Object.values(object)) collectCteNames(child, facts);
}

function targetKeyFromFunction(
  object: Record<string, JsonValue>,
): string | null {
  const children = arrayValue(object["children"]);
  if (children.length !== 1) return null;
  const child = objectValue(children[0]);
  if (child === null || stringValue(child["class"]) !== "CONSTANT") {
    return null;
  }
  const constant = objectValue(child["value"]);
  if (constant === null) return null;
  const type = objectValue(constant["type"]);
  if (type === null || stringValue(type["id"]) !== "VARCHAR") return null;
  return stringValue(constant["value"]);
}

function physicalTableName(object: Record<string, JsonValue>): string | null {
  const table = stringValue(object["table_name"]);
  if (table === null) return null;
  const catalog = stringValue(object["catalog_name"]) ?? "";
  const schema = stringValue(object["schema_name"]) ?? "";
  return [catalog, schema, table].filter((part) => part.length > 0).join(".");
}

function collectStructuralFacts(
  object: Record<string, JsonValue>,
  facts: AstFacts,
): void {
  const nodeType = stringValue(object["type"]);
  if (nodeType === "RECURSIVE_CTE_NODE") facts.recursive = true;
  if (nodeType === "JOIN") facts.joinedRelations += 1;
  if (nodeType === "BASE_TABLE") {
    const tableName = stringValue(object["table_name"]);
    const qualifiedName = physicalTableName(object);
    const unqualifiedCte =
      tableName !== null &&
      qualifiedName === tableName &&
      facts.cteNames.has(tableName);
    if (qualifiedName !== null && !unqualifiedCte) {
      facts.physicalSources.push(qualifiedName);
    }
  }
}

function collectFunctionFacts(
  object: Record<string, JsonValue>,
  facts: AstFacts,
): void {
  const functionName = stringValue(object["function_name"]);
  if (functionName === null) return;
  facts.functions.push(functionName);
  if (functionName !== "dare_target") return;
  const targetKey = targetKeyFromFunction(object);
  if (targetKey === null) {
    facts.invalidTargetCalls += 1;
  } else {
    facts.targetKeys.push(targetKey);
  }
}

function collectColumnFacts(
  object: Record<string, JsonValue>,
  facts: AstFacts,
): void {
  const columnNames = arrayValue(object["column_names"]);
  const unqualifiedName =
    columnNames.length === 1 ? stringValue(columnNames[0]) : null;
  if (
    unqualifiedName === "current_date" ||
    unqualifiedName === "current_timestamp"
  ) {
    facts.wallClockReferences.push(unqualifiedName);
  }
}

function collectExpressionFacts(
  object: Record<string, JsonValue>,
  expressionClass: string | null,
  facts: AstFacts,
): void {
  if (expressionClass === "COMPARISON" || expressionClass === "CONJUNCTION") {
    facts.predicates += 1;
  }
  if (expressionClass === "FUNCTION") collectFunctionFacts(object, facts);
  if (expressionClass === "COLUMN_REF") collectColumnFacts(object, facts);
}

function collectAstFacts(
  value: JsonValue,
  facts: AstFacts,
  expressionDepth: number,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectAstFacts(item, facts, expressionDepth);
    return;
  }
  const object = objectValue(value);
  if (object === null) return;
  const expressionClass = stringValue(object["class"]);
  const nextExpressionDepth =
    expressionClass === null ? expressionDepth : expressionDepth + 1;
  facts.maxExpressionDepth = Math.max(
    facts.maxExpressionDepth,
    nextExpressionDepth,
  );
  collectStructuralFacts(object, facts);
  collectExpressionFacts(object, expressionClass, facts);
  for (const child of Object.values(object)) {
    collectAstFacts(child, facts, nextExpressionDepth);
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted();
}

function semanticIssues(
  statement: JsonValue,
  allowedTargetKeys: ReadonlySet<string>,
  limits: RelationalScoutQlComplexityLimits,
  profile: "relational-v2" | "dare-sql-v3",
): { issues: string[]; facts: RelationalScoutQlFacts } {
  const mutableFacts: AstFacts = {
    cteNames: new Set(),
    functions: [],
    physicalSources: [],
    targetKeys: [],
    cteCount: 0,
    joinedRelations: 0,
    predicates: 0,
    maxExpressionDepth: 0,
    recursive: false,
    wallClockReferences: [],
    invalidTargetCalls: 0,
  };
  collectCteNames(statement, mutableFacts);
  collectAstFacts(statement, mutableFacts, 0);
  const physicalSources = uniqueSorted(mutableFacts.physicalSources);
  const functions = uniqueSorted(mutableFacts.functions);
  const targetKeys =
    profile === "dare-sql-v3"
      ? physicalSources.filter((source) => /^T[1-5]$/u.test(source))
      : uniqueSorted(mutableFacts.targetKeys);
  const issues = relationalScoutQlOutputIssues(statement);
  if (mutableFacts.recursive) {
    issues.push("Recursive CTEs are not supported in ScoutQL.");
  }
  appendWallClockIssues(mutableFacts.wallClockReferences, issues);
  appendRelationalScoutQlLimitIssues(mutableFacts, limits, issues);
  appendRelationalScoutQlCatalogIssues({
    physicalSources,
    functions,
    targetKeys,
    allowedTargetKeys,
    allowedSources:
      profile === "dare-sql-v3"
        ? DARE_SQL_V3_SOURCES
        : RELATIONAL_SCOUTQL_SOURCES,
    allowedFunctions:
      profile === "dare-sql-v3"
        ? DARE_SQL_V3_FUNCTIONS
        : RELATIONAL_SCOUTQL_FUNCTIONS,
    issues,
  });
  appendTargetBindingIssues({
    profile,
    targetKeys,
    allowedTargetKeys,
    invalidTargetCalls: mutableFacts.invalidTargetCalls,
    issues,
  });
  appendTimelineCoverageIssues(profile, physicalSources, issues);
  if (profile === "dare-sql-v3") {
    appendDareSqlV3DeterminismIssues(statement, issues);
  }
  return {
    issues,
    facts: {
      cteCount: mutableFacts.cteCount,
      joinedRelations: mutableFacts.joinedRelations,
      predicates: mutableFacts.predicates,
      maxExpressionDepth: mutableFacts.maxExpressionDepth,
      physicalSources,
      functions,
      targetKeys,
    },
  };
}

async function serializeSql(queryText: string) {
  const rows = await withDuckDBConnection(
    async (session) =>
      await session.run(
        "SELECT json_serialize_sql(CAST(? AS VARCHAR)) AS ast",
        [queryText],
      ),
  );
  const row = AstRowSchema.parse(rows[0]);
  const parsedJson: unknown = JSON.parse(row.ast);
  return {
    serialized: row.ast,
    envelope: SerializedSqlSchema.parse(parsedJson),
  };
}

async function canonicalSql(serializedAst: string): Promise<string> {
  const rows = await withDuckDBConnection(
    async (session) =>
      await session.run("SELECT json_deserialize_sql(CAST(? AS JSON)) AS sql", [
        serializedAst,
      ]),
  );
  return CanonicalRowSchema.parse(rows[0]).sql;
}

/**
 * Parse and canonically compile relational ScoutQL without ever executing the
 * submitted query. DuckDB supplies the SQL AST; Scout then applies a strict,
 * closed-world policy before retaining the canonical AST as the immutable plan.
 */
async function validateRelationalScoutQlWithLimits(
  input: {
    queryText: string;
    allowedTargetKeys: readonly string[];
  },
  limits: RelationalScoutQlComplexityLimits,
  profile: "relational-v2" | "dare-sql-v3" = "relational-v2",
): Promise<RelationalScoutQlValidation> {
  if (input.queryText.length > DARE_V2_MAX_QUERY_LENGTH) {
    return {
      kind: "invalid",
      issues: [
        `ScoutQL may be at most ${DARE_V2_MAX_QUERY_LENGTH.toString()} characters.`,
      ],
    };
  }
  const parsed = await serializeSql(input.queryText);
  if (parsed.envelope.error) {
    const message =
      parsed.envelope.error_message ?? "DuckDB could not parse ScoutQL.";
    return {
      kind: "invalid",
      issues: message.includes("Only SELECT statements")
        ? ["ScoutQL must contain exactly one SELECT statement."]
        : [message],
    };
  }
  const statements = parsed.envelope.statements ?? [];
  if (statements.length !== 1) {
    return {
      kind: "invalid",
      issues: ["ScoutQL must contain exactly one statement."],
    };
  }
  const statement = statements[0];
  if (statement === undefined) {
    throw new Error("ScoutQL statement count changed after validation.");
  }
  const analysis = semanticIssues(
    statement,
    new Set(input.allowedTargetKeys),
    limits,
    profile,
  );
  if (analysis.issues.length > 0) {
    return { kind: "invalid", issues: analysis.issues };
  }
  const canonicalScoutQl = await canonicalSql(parsed.serialized);
  const canonical = await serializeSql(canonicalScoutQl);
  const planHash = new Bun.CryptoHasher("sha256")
    .update(canonical.serialized)
    .digest("hex");
  return {
    kind: "valid",
    compilation: {
      canonicalScoutQl,
      immutableAst: canonical.serialized,
      planHash,
      facts: analysis.facts,
    },
  };
}

export async function validateRelationalScoutQl(input: {
  queryText: string;
  allowedTargetKeys: readonly string[];
}): Promise<RelationalScoutQlValidation> {
  return await validateRelationalScoutQlWithLimits(
    input,
    RAW_RELATIONAL_SCOUTQL_LIMITS,
  );
}

/**
 * Structural validation envelope for canonical Dare queries. Callers must
 * additionally reverse-compile, semantically validate, and exact-round-trip
 * the query before accepting it as a contract.
 */
export async function validateCanonicalDareScoutQl(input: {
  queryText: string;
  allowedTargetKeys: readonly string[];
}): Promise<RelationalScoutQlValidation> {
  return await validateRelationalScoutQlWithLimits(
    input,
    CANONICAL_DARE_SCOUTQL_LIMITS,
  );
}

export async function validateDareSqlV3(input: {
  queryText: string;
  allowedTargetKeys: readonly string[];
}): Promise<RelationalScoutQlValidation> {
  return await validateRelationalScoutQlWithLimits(
    input,
    RAW_RELATIONAL_SCOUTQL_LIMITS,
    "dare-sql-v3",
  );
}
