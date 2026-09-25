import { z } from "zod";
import { DEFAULT_RENDER_SPEC } from "@scout-for-lol/data/model/reports/report.ts";
import type {
  ScoutQlOutput,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import { GLOBAL_SCOPE } from "#src/reports/duckdb/scope.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import {
  compileScoutQlPlanQuery,
  type CompiledPlanQuery,
  type PlanQueryInput,
} from "#src/reports/duckdb/compile-plan.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import type { BoundParam } from "#src/reports/duckdb/lake.ts";

/**
 * Compile a ScoutQL plan and run it against a real DuckDB lake, for
 * end-to-end compiler tests. Rows come back parsed as records, counts as
 * numbers whichever integer type DuckDB returned.
 */

export const CountSchema = z.union([z.bigint(), z.number()]).transform(Number);
export const RowSchema = z.record(z.string(), z.unknown());

export async function execute(compiled: CompiledPlanQuery): Promise<{
  rows: Record<string, unknown>[];
  scanned: number;
}> {
  return await withDuckDBConnection(async (session) => {
    const bind = (params: BoundParam[]) =>
      params.map((param) =>
        param.kind === "list" ? session.list(param.values) : param.value,
      );
    const rawRows = await session.run(
      compiled.aggregateSql,
      bind(compiled.aggregateParams),
    );
    const scannedRows = await session.run(
      compiled.scannedSql,
      bind(compiled.scannedParams),
    );
    const scanned = z
      .object({ scanned: CountSchema })
      .parse(scannedRows[0]).scanned;
    return { rows: rawRows.map((row) => RowSchema.parse(row)), scanned };
  });
}

export async function runPlan(input: PlanQueryInput): Promise<{
  rows: Record<string, unknown>[];
  scanned: number;
  compiled: CompiledPlanQuery;
}> {
  const compiled = compileScoutQlPlanQuery(input);
  if (compiled === undefined) {
    throw new Error("expected compiled query");
  }
  const result = await execute(compiled);
  return { ...result, compiled };
}

export function number_(value: unknown): number {
  return CountSchema.parse(value);
}

/** Run a plan and key each row's numeric outputs by its group label. */
export async function outputsByLabel(
  input: PlanQueryInput,
): Promise<Record<string, number[]>> {
  const { rows, compiled } = await runPlan(input);
  return Object.fromEntries(
    rows.map((row) => [
      String(row[compiled.columns.label]),
      compiled.columns.outputs.map((output) => number_(row[output.alias])),
    ]),
  );
}

// ── Plan builders for end-to-end tests ───────────────────────────────────────

export function col(column: string): ScoutQlScalarExpr {
  return { kind: "column", column };
}

export function eq(
  column: string,
  value: number | string | boolean,
): ScoutQlPredicate {
  return {
    kind: "compare",
    op: "=",
    left: col(column),
    right: { kind: "literal", value },
  };
}

export function and(...operands: ScoutQlPredicate[]): ScoutQlPredicate {
  return { kind: "and", operands };
}

export const COUNT_OUTPUT: ScoutQlOutput = {
  name: "rows",
  expr: { kind: "count-star" },
  displayKind: "count",
  additive: true,
  evidence: { kind: "sample" },
};

export function avgOf(arg: ScoutQlScalarExpr): ScoutQlOutput {
  return {
    name: "avg",
    expr: { kind: "aggregate", func: "avg", arg, distinct: false },
    displayKind: "decimal",
    additive: false,
    evidence: { kind: "sample" },
  };
}

/** A global-scope, all-time query of one source, open to per-test overrides. */
export function sourceInput(
  files: LakeFiles,
  plan: Partial<ScoutQlPlan> & Pick<ScoutQlPlan, "source">,
  overrides: Partial<PlanQueryInput> = {},
): PlanQueryInput {
  return {
    plan: {
      outputs: [COUNT_OUTPUT],
      timeWindow: { kind: "unbounded" },
      groupings: [],
      orderBy: [],
      limit: 25,
      playerRefs: [],
      render: DEFAULT_RENDER_SPEC,
      ...plan,
    },
    scope: GLOBAL_SCOPE,
    files,
    range: { start: new Date(0), end: new Date(Date.UTC(2027, 0, 1)) },
    limit: 25,
    ...overrides,
  };
}
