import { z } from "zod";
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
