import type {
  DareSqlV3Compilation,
  DareTargetBindingV2,
} from "@scout-for-lol/data";
import {
  dareSqlV3CteColumnTargetDependenciesFromAst,
  dareSqlV3CteTargetDependenciesFromAst,
} from "#src/betting/dare-sql-v3-finality.ts";
import { relationalScoutQlStatementFromImmutableAst } from "#src/reports/duckdb/relational-scoutql.ts";
import {
  relationalScoutQlArrayValue as arrayValue,
  relationalScoutQlObjectValue as objectValue,
  relationalScoutQlStringValue as stringValue,
  type RelationalScoutQlJsonValue as JsonValue,
} from "#src/reports/duckdb/relational-scoutql-json.ts";

export type DareSqlV3ExecutionSummary = {
  achieved: boolean | null;
};

type CompileDareSqlV3 = (input: {
  queryText: string;
  targetKeys: readonly string[];
}) => Promise<DareSqlV3Compilation>;

type ExecuteDareSqlV3 = (input: {
  compilation: DareSqlV3Compilation;
  targets: readonly DareTargetBindingV2[];
  start: Date;
  end: Date;
  lakeDir?: string | undefined;
}) => Promise<DareSqlV3ExecutionSummary>;

function outerParenthesesWrap(expression: string): boolean {
  if (!expression.startsWith("(") || !expression.endsWith(")")) return false;
  let depth = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && index < expression.length - 1) return false;
  }
  return depth === 0;
}

function stripOuterParentheses(expression: string): string {
  let current = expression.trim();
  while (
    outerParenthesesWrap(current) &&
    current.startsWith("(") &&
    current.endsWith(")")
  ) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function topLevelOrBranches(expression: string): string[] {
  const normalized = stripOuterParentheses(expression);
  const branches: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (
      depth === 0 &&
      normalized.slice(index, index + 4).toUpperCase() === " OR "
    ) {
      branches.push(normalized.slice(start, index).trim());
      start = index + 4;
      index += 3;
    }
  }
  branches.push(normalized.slice(start).trim());
  return branches;
}

function rootExpressionIsOr(immutableAst: string): boolean {
  const statement = objectValue(
    relationalScoutQlStatementFromImmutableAst(immutableAst),
  );
  const node = objectValue(statement?.["node"]);
  const select = objectValue(arrayValue(node?.["select_list"])[0]);
  return (
    stringValue(select?.["class"]) === "CONJUNCTION" &&
    stringValue(select?.["type"]) === "CONJUNCTION_OR"
  );
}

function aliasesFromAst(
  value: JsonValue,
  targetKeys: readonly string[],
  aliases: Map<string, string>,
): void {
  if (Array.isArray(value)) {
    for (const child of value) aliasesFromAst(child, targetKeys, aliases);
    return;
  }
  const object = objectValue(value);
  if (object === null) return;
  const table = stringValue(object["table_name"]);
  const alias = stringValue(object["alias"]);
  if (
    table !== null &&
    alias !== null &&
    alias.length > 0 &&
    targetKeys.includes(table)
  ) {
    const normalized = alias.toLowerCase();
    const existing = aliases.get(normalized);
    if (existing !== undefined && existing !== table)
      aliases.delete(normalized);
    else aliases.set(normalized, table);
  }
  for (const child of Object.values(object)) {
    aliasesFromAst(child, targetKeys, aliases);
  }
}

function containsTargetSource(
  value: JsonValue,
  targetKeys: readonly string[],
): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => containsTargetSource(child, targetKeys));
  }
  const object = objectValue(value);
  if (object === null) return false;
  if (targetKeys.includes(stringValue(object["table_name"]) ?? "")) return true;
  return Object.values(object).some((child) =>
    containsTargetSource(child, targetKeys),
  );
}

function containsAggregate(value: JsonValue): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => containsAggregate(child));
  }
  const object = objectValue(value);
  if (object === null) return false;
  const name = stringValue(object["function_name"]);
  if (
    name !== null &&
    /^(?:avg|bool_and|bool_or|count|count_star|max|min|sum)$/iu.test(name)
  ) {
    return true;
  }
  return Object.values(object).some((child) => containsAggregate(child));
}

function containsGrouping(value: JsonValue): boolean {
  if (Array.isArray(value))
    return value.some((child) => containsGrouping(child));
  const object = objectValue(value);
  if (object === null) return false;
  if (Object.keys(object).some((key) => key.toLowerCase().includes("group")))
    return true;
  return Object.values(object).some((child) => containsGrouping(child));
}

function containsUnsafeScalarSubquery(
  value: JsonValue,
  targetKeys: readonly string[],
): boolean {
  if (Array.isArray(value)) {
    return value.some((child) =>
      containsUnsafeScalarSubquery(child, targetKeys),
    );
  }
  const object = objectValue(value);
  if (object === null) return false;
  if (
    stringValue(object["class"]) === "SUBQUERY" &&
    stringValue(object["subquery_type"]) === "SCALAR"
  ) {
    const subquery = objectValue(object["subquery"]);
    const node = objectValue(subquery?.["node"]);
    if (
      node !== null &&
      (!containsAggregate(node) || containsGrouping(node)) &&
      containsTargetSource(node, targetKeys)
    ) {
      return true;
    }
  }
  return Object.values(object).some((child) =>
    containsUnsafeScalarSubquery(child, targetKeys),
  );
}

export function rootQueryParts(canonicalSql: string) {
  const lower = canonicalSql.toLowerCase();
  let depth = 0;
  let selectIndex = -1;
  for (let index = 0; index < lower.length; index += 1) {
    const character = lower[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && lower.slice(index, index + 7) === "select ") {
      selectIndex = index;
    }
  }
  const achievedIndex = lower.lastIndexOf(" as achieved");
  if (selectIndex < 0 || achievedIndex <= selectIndex) return null;
  return {
    prefix: canonicalSql.slice(0, selectIndex),
    expression: canonicalSql.slice(
      selectIndex + "select ".length,
      achievedIndex,
    ),
    suffix: canonicalSql.slice(achievedIndex + " as achieved".length),
  };
}

export function rootHasMultipleRows(
  canonicalSql: string,
  immutableAst?: string,
  targetKeys: readonly string[] = [],
): boolean {
  const parts = rootQueryParts(canonicalSql);
  if (parts === null) return true;
  if (
    /\b(?:GROUP\s+BY|HAVING|QUALIFY|UNION(?:\s+ALL)?)\b/iu.test(parts.suffix)
  ) {
    return true;
  }
  const hasFrom = /\bFROM\b/iu.test(parts.suffix);
  const hasAggregate =
    /\b(?:AVG|BOOL_AND|BOOL_OR|COUNT(?:_STAR)?|MAX|MIN|SUM)\s*\(/iu.test(
      parts.expression,
    );
  if (hasFrom && !hasAggregate) return true;
  if (immutableAst !== undefined && targetKeys.length > 0) {
    const statement = relationalScoutQlStatementFromImmutableAst(immutableAst);
    if (containsUnsafeScalarSubquery(statement, targetKeys)) return true;
  }
  return false;
}

function targetDependenciesIn(
  text: string,
  targetKeys: readonly string[],
  aliases: ReadonlyMap<string, string>,
) {
  return targetKeys.filter((key) => {
    if (new RegExp(String.raw`\b${key}\b`, "iu").test(text)) return true;
    return [...aliases.entries()].some(
      ([alias, target]) =>
        target === key && new RegExp(String.raw`\b${alias}\b`, "iu").test(text),
    );
  });
}

function columnDependenciesIn(
  text: string,
  columns: ReadonlyMap<string, readonly string[]>,
): string[] {
  const qualified = [...columns.entries()]
    .filter(([column]) => {
      const [name, field] = column.split(".");
      return (
        name !== undefined &&
        field !== undefined &&
        new RegExp(String.raw`\b${name}\s*\.\s*${field}\b`, "iu").test(text)
      );
    })
    .flatMap(([, dependencies]) => dependencies)
    .toSorted()
    .filter((key, index, keys) => keys[index - 1] !== key);
  if (qualified.length > 0) return qualified;
  const fields = new Map<string, readonly string[]>();
  for (const [column, dependencies] of columns) {
    const field = column.split(".")[1];
    if (field === undefined) continue;
    const existing = fields.get(field);
    fields.set(
      field,
      existing === undefined ? dependencies : [...existing, ...dependencies],
    );
  }
  return [...fields.entries()]
    .filter(([field]) => new RegExp(String.raw`\b${field}\b`, "iu").test(text))
    .flatMap(([, dependencies]) => dependencies)
    .toSorted()
    .filter((key, index, keys) => keys[index - 1] !== key);
}

export async function decisiveTargetDependenciesV3(input: {
  compilation: DareSqlV3Compilation;
  targets: readonly DareTargetBindingV2[];
  start: Date;
  end: Date;
  lakeDir?: string | undefined;
  compile: CompileDareSqlV3;
  execute: ExecuteDareSqlV3;
}): Promise<string[]> {
  const parts = rootQueryParts(input.compilation.canonicalSql);
  if (parts === null) return input.compilation.facts.targetKeys;
  if (!rootExpressionIsOr(input.compilation.immutableAst)) {
    return input.compilation.facts.targetKeys;
  }
  const branches = topLevelOrBranches(parts.expression);
  if (branches.length < 2) return input.compilation.facts.targetKeys;
  const aliases = new Map<string, string>();
  aliasesFromAst(
    relationalScoutQlStatementFromImmutableAst(input.compilation.immutableAst),
    input.compilation.facts.targetKeys,
    aliases,
  );
  return await decisiveOrBranchDependencies(input, parts, branches, aliases);
}

async function decisiveOrBranchDependencies(
  input: {
    compilation: DareSqlV3Compilation;
    targets: readonly DareTargetBindingV2[];
    start: Date;
    end: Date;
    lakeDir?: string | undefined;
    compile: CompileDareSqlV3;
    execute: ExecuteDareSqlV3;
  },
  parts: { prefix: string; expression: string; suffix: string },
  branches: readonly string[],
  aliases: ReadonlyMap<string, string>,
): Promise<string[]> {
  const cteTargetDependencies = dareSqlV3CteTargetDependenciesFromAst(
    input.compilation.immutableAst,
    input.compilation.facts.targetKeys,
  );
  const cteColumnDependencies = dareSqlV3CteColumnTargetDependenciesFromAst(
    input.compilation.immutableAst,
    input.compilation.facts.targetKeys,
  );
  for (const branch of branches) {
    const dependencies = await evaluateOrBranch({
      input,
      parts,
      branch,
      aliases,
      cteTargetDependencies,
      cteColumnDependencies,
    });
    if (dependencies !== null) return dependencies;
  }
  return input.compilation.facts.targetKeys;
}

async function evaluateOrBranch(options: {
  input: {
    compilation: DareSqlV3Compilation;
    targets: readonly DareTargetBindingV2[];
    start: Date;
    end: Date;
    lakeDir?: string | undefined;
    compile: CompileDareSqlV3;
    execute: ExecuteDareSqlV3;
  };
  parts: { prefix: string; suffix: string };
  branch: string;
  aliases: ReadonlyMap<string, string>;
  cteTargetDependencies: ReadonlyMap<string, readonly string[]>;
  cteColumnDependencies: ReadonlyMap<string, readonly string[]>;
}): Promise<string[] | null> {
  const {
    input,
    parts,
    branch,
    aliases,
    cteTargetDependencies,
    cteColumnDependencies,
  } = options;
  const branchTargetKeys = targetDependenciesIn(
    `${parts.prefix} ${branch}`,
    input.compilation.facts.targetKeys,
    aliases,
  );
  const compilation = await input.compile({
    queryText: `${parts.prefix}SELECT (${branch}) = TRUE AS achieved${parts.suffix}`,
    targetKeys:
      branchTargetKeys.length > 0
        ? branchTargetKeys
        : input.targets.map((target) => target.key),
  });
  const evidence = await input.execute({
    compilation,
    targets: input.targets,
    start: input.start,
    end: input.end,
    ...(input.lakeDir === undefined ? {} : { lakeDir: input.lakeDir }),
  });
  if (evidence.achieved !== true) return null;
  const direct = targetDependenciesIn(
    branch,
    input.compilation.facts.targetKeys,
    aliases,
  );
  if (direct.length > 0) return direct;
  const inherited = [...cteTargetDependencies.entries()]
    .filter(([name]) => new RegExp(String.raw`\b${name}\b`, "iu").test(branch))
    .flatMap(([, dependencies]) => dependencies)
    .toSorted()
    .filter((key, index, keys) => keys[index - 1] !== key);
  const projected = columnDependenciesIn(branch, cteColumnDependencies);
  return projected.length > 0
    ? projected
    : inherited.length > 0
      ? inherited
      : input.compilation.facts.targetKeys;
}
