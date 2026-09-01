import { z } from "zod";
import {
  DARE_V2_MAX_EXPRESSION_DEPTH,
  DARE_V2_MAX_GAME_SETS,
  DARE_V2_MAX_JOINED_RELATIONS,
  DARE_V2_MAX_PREDICATES,
  DARE_V2_MAX_QUERY_LENGTH,
} from "@scout-for-lol/data";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";

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
  "dare_target",
  "greatest",
  "max",
  "min",
  "nullif",
  "sum",
]);

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

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

function objectValue(value: JsonValue | undefined) {
  if (value === undefined || value === null || Array.isArray(value))
    return null;
  if (typeof value !== "object") return null;
  return value;
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
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
  const firstChild = arrayValue(object["children"])[0];
  const child = firstChild === undefined ? null : objectValue(firstChild);
  const constant = child === null ? null : objectValue(child["value"]);
  return constant === null ? null : stringValue(constant["value"]);
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
    if (tableName !== null && !facts.cteNames.has(tableName)) {
      facts.physicalSources.push(tableName);
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
  if (targetKey !== null) facts.targetKeys.push(targetKey);
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

function outerSelectIssues(statement: JsonValue): string[] {
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
  return [];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted();
}

function appendLimitIssues(facts: AstFacts, issues: string[]): void {
  const limits = [
    {
      actual: facts.cteCount,
      maximum: DARE_V2_MAX_GAME_SETS,
      label: "CTEs",
    },
    {
      actual: facts.joinedRelations,
      maximum: DARE_V2_MAX_JOINED_RELATIONS,
      label: "joined relations",
    },
    {
      actual: facts.predicates,
      maximum: DARE_V2_MAX_PREDICATES,
      label: "predicates",
    },
  ];
  for (const limit of limits) {
    if (limit.actual > limit.maximum) {
      issues.push(
        `ScoutQL may contain at most ${limit.maximum.toString()} ${limit.label}.`,
      );
    }
  }
  if (facts.maxExpressionDepth > DARE_V2_MAX_EXPRESSION_DEPTH) {
    issues.push(
      `ScoutQL expressions may be at most ${DARE_V2_MAX_EXPRESSION_DEPTH.toString()} levels deep.`,
    );
  }
}

function appendCatalogIssues(input: {
  physicalSources: readonly string[];
  functions: readonly string[];
  targetKeys: readonly string[];
  allowedTargetKeys: ReadonlySet<string>;
  issues: string[];
}): void {
  for (const source of input.physicalSources) {
    if (!RELATIONAL_SCOUTQL_SOURCES.has(source)) {
      input.issues.push(
        `ScoutQL source ${source} is not in the closed source catalog.`,
      );
    }
  }
  for (const functionName of input.functions) {
    if (!RELATIONAL_SCOUTQL_FUNCTIONS.has(functionName)) {
      input.issues.push(
        `ScoutQL function ${functionName} is not in the closed function catalog.`,
      );
    }
  }
  for (const targetKey of input.targetKeys) {
    if (!input.allowedTargetKeys.has(targetKey)) {
      input.issues.push(
        `ScoutQL target ${targetKey} is not a frozen dare target.`,
      );
    }
  }
}

function semanticIssues(
  statement: JsonValue,
  allowedTargetKeys: ReadonlySet<string>,
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
  };
  collectCteNames(statement, mutableFacts);
  collectAstFacts(statement, mutableFacts, 0);
  const physicalSources = uniqueSorted(mutableFacts.physicalSources);
  const functions = uniqueSorted(mutableFacts.functions);
  const targetKeys = uniqueSorted(mutableFacts.targetKeys);
  const issues = outerSelectIssues(statement);
  if (mutableFacts.recursive) {
    issues.push("Recursive CTEs are not supported in ScoutQL.");
  }
  for (const wallClock of uniqueSorted(mutableFacts.wallClockReferences)) {
    issues.push(
      `ScoutQL wall-clock reference ${wallClock} is not allowed; use immutable bound parameters.`,
    );
  }
  appendLimitIssues(mutableFacts, issues);
  appendCatalogIssues({
    physicalSources,
    functions,
    targetKeys,
    allowedTargetKeys,
    issues,
  });
  if (targetKeys.length === 0) {
    issues.push(
      "A Dare contract query must bind at least one dare_target(...).",
    );
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
export async function validateRelationalScoutQl(input: {
  queryText: string;
  allowedTargetKeys: readonly string[];
}): Promise<RelationalScoutQlValidation> {
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
  const analysis = semanticIssues(statement, new Set(input.allowedTargetKeys));
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
