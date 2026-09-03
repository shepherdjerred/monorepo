import type {
  DareSqlV3Compilation,
  DareTargetBindingV2,
} from "@scout-for-lol/data";
import { dareSqlV3CteTargetDependenciesFromAst } from "#src/betting/dare-sql-v3-finality.ts";

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

export function rootHasMultipleRows(canonicalSql: string): boolean {
  const achievedIndex = canonicalSql.toLowerCase().lastIndexOf(" as achieved");
  if (achievedIndex === -1) return true;
  const suffix = canonicalSql.slice(achievedIndex);
  return /\b(?:GROUP\s+BY|HAVING|QUALIFY|UNION(?:\s+ALL)?)\b/iu.test(suffix);
}

function targetDependenciesIn(text: string, targetKeys: readonly string[]) {
  return targetKeys.filter((key) =>
    new RegExp(String.raw`\b${key}\b`, "iu").test(text),
  );
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
  const branches = topLevelOrBranches(parts.expression);
  if (branches.length < 2) return input.compilation.facts.targetKeys;
  const cteTargetDependencies = dareSqlV3CteTargetDependenciesFromAst(
    input.compilation.immutableAst,
    input.compilation.facts.targetKeys,
  );
  for (const branch of branches) {
    const branchTargetKeys = targetDependenciesIn(
      `${parts.prefix} ${branch}`,
      input.compilation.facts.targetKeys,
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
    if (evidence.achieved === true) {
      const direct = targetDependenciesIn(
        branch,
        input.compilation.facts.targetKeys,
      );
      if (direct.length > 0) return direct;
      const inherited = [...cteTargetDependencies.entries()]
        .filter(([name]) =>
          new RegExp(String.raw`\b${name}\b`, "iu").test(branch),
        )
        .flatMap(([, dependencies]) => dependencies)
        .toSorted()
        .filter((key, index, keys) => keys[index - 1] !== key);
      return inherited.length > 0
        ? inherited
        : input.compilation.facts.targetKeys;
    }
  }
  return input.compilation.facts.targetKeys;
}
