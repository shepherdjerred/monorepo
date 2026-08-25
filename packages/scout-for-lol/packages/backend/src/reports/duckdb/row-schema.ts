import { z } from "zod";
import type { CompiledGroupFactsColumns } from "#src/reports/duckdb/compile-plan.ts";
import type { CompiledPlanColumns } from "#src/reports/duckdb/select-sql.ts";

/**
 * Per-plan Zod schemas for DuckDB result rows.
 *
 * There is no fixed counter table any more: a plan's SELECT list is whatever
 * the author wrote, so the schema is built from `CompiledPlanColumns` — the
 * positional aliases the compiler emitted — and is `.strict()`, so a column the
 * engine did not ask for (or one it asked for and the compiler forgot) fails
 * loudly instead of being read as `undefined` three layers later.
 *
 * DuckDB hands back richer JS values than the report layer models: BIGINT and
 * HUGEINT arrive as `bigint`, TIMESTAMP as a `DuckDBTimestampValue`
 * (`{ micros }`), DECIMAL as a `DuckDBDecimalValue` (`{ width, scale, value }`).
 * Everything is normalized here, once, with a safe-integer guard on every
 * integral conversion — report aggregates live far below 2^53, so a violation
 * means something is deeply wrong and must not be silently rounded.
 */

export type LakeScalar = number | string | boolean | null;

/** A value an output column may carry into a report row. */
export type LakeOutputValue = number | string | null;

const MICROS_PER_MS = 1000n;

function safeNumber(value: bigint, ctx: z.RefinementCtx): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    ctx.addIssue({
      code: "custom",
      message: `value ${value.toString()} exceeds safe integer range`,
    });
    return Number.NaN;
  }
  return asNumber;
}

const TimestampValueSchema = z.object({ micros: z.bigint() });
const DecimalValueSchema = z.object({
  width: z.number(),
  scale: z.number(),
  value: z.bigint(),
});

/**
 * Any scalar DuckDB can put in a result cell, normalized to a JS scalar.
 * Timestamps become ISO-8601 UTC strings: lake timestamps are naive UTC, so
 * the micros are already the instant, and a string is both comparable and
 * directly renderable.
 */
export const DuckDbScalarSchema: z.ZodType<LakeScalar> = z
  .union([
    z.null(),
    z.string(),
    z.boolean(),
    z.number(),
    z.bigint(),
    TimestampValueSchema,
    DecimalValueSchema,
  ])
  .transform((value, ctx): LakeScalar => {
    if (typeof value === "bigint") {
      return safeNumber(value, ctx);
    }
    if (value !== null && typeof value === "object") {
      if ("micros" in value) {
        return new Date(
          safeNumber(value.micros / MICROS_PER_MS, ctx),
        ).toISOString();
      }
      return Number(value.value) / 10 ** value.scale;
    }
    return value;
  });

/**
 * An output cell. Booleans (`MIN(win)`) render as their SQL spelling rather
 * than as 0/1, because a boolean output displays as text, and 0 would read as
 * a count of nothing.
 */
const OutputValueSchema: z.ZodType<LakeScalar> = DuckDbScalarSchema.transform(
  (value): LakeScalar => (typeof value === "boolean" ? String(value) : value),
);

/**
 * An evidence companion is always a count-shaped aggregate. NULL means the
 * FILTER matched no rows, which for a count is zero — not "unknown".
 */
const EvidenceCountSchema: z.ZodType<LakeScalar> = DuckDbScalarSchema.transform(
  (value, ctx): LakeScalar => {
    if (value === null) return 0;
    if (typeof value !== "number") {
      ctx.addIssue({
        code: "custom",
        message: `evidence companion is not numeric (${typeof value})`,
      });
      return Number.NaN;
    }
    return value;
  },
);

export type PlanRowShape = Record<string, LakeScalar>;

/**
 * Build the strict row schema for one compiled plan.
 *
 * Aliases legitimately repeat — a grouping echo reuses `__key_j`, and the
 * evidence pool reuses an output's own alias when the SQL text is identical —
 * so the shape is assembled by name with a "first writer wins" rule; the
 * competing schemas for a shared alias are the same schema.
 */
export function planRowSchema(
  columns: CompiledPlanColumns,
): z.ZodType<PlanRowShape> {
  const shape: Record<string, z.ZodType<LakeScalar>> = {
    [columns.label]: DuckDbScalarSchema,
    [columns.playerId]: DuckDbScalarSchema,
    [columns.discordId]: DuckDbScalarSchema,
  };
  for (const key of columns.groupingKeys) {
    shape[key] ??= DuckDbScalarSchema;
  }
  for (const output of columns.outputs) {
    shape[output.alias] ??= OutputValueSchema;
    for (const alias of evidenceAliases(output.evidence)) {
      shape[alias] ??= EvidenceCountSchema;
    }
  }
  return z.strictObject(shape);
}

function evidenceAliases(
  evidence: CompiledPlanColumns["outputs"][number]["evidence"],
): string[] {
  if (evidence.kind === "rate") return [evidence.successes, evidence.trials];
  if (evidence.kind === "ratio") {
    return [evidence.numerator, evidence.denominator];
  }
  return [evidence.sampleCount];
}

export const LakeScannedRowSchema = z.object({ scanned: DuckDbScalarSchema });

/**
 * The raw per-player fact rows the player_groups projection returns. Identity
 * and unit columns are typed; every referenced value column is a normalized
 * scalar the JS aggregate evaluator reads.
 */
export function groupFactRowSchema(
  columns: CompiledGroupFactsColumns,
): z.ZodType<PlanRowShape> {
  const shape: Record<string, z.ZodType<LakeScalar>> = {
    [columns.playerId]: DuckDbScalarSchema,
    [columns.playerAlias]: DuckDbScalarSchema,
    [columns.discordId]: DuckDbScalarSchema,
    [columns.puuid]: DuckDbScalarSchema,
    [columns.matchId]: DuckDbScalarSchema,
    [columns.teamId]: DuckDbScalarSchema,
    [columns.playerSubteamId]: DuckDbScalarSchema,
  };
  for (const name of columns.raw) {
    shape[name] ??= DuckDbScalarSchema;
  }
  return z.strictObject(shape);
}

/** Read a column the schema guarantees, failing loudly if the plan drifted. */
export function requireField(row: PlanRowShape, name: string): LakeScalar {
  if (!(name in row)) {
    throw new Error(`Result row is missing the "${name}" column.`);
  }
  return row[name] ?? null;
}

export function requireNumberField(row: PlanRowShape, name: string): number {
  const value = requireField(row, name);
  if (typeof value !== "number") {
    throw new TypeError(`Result column "${name}" is not numeric.`);
  }
  return value;
}

export function requireStringField(row: PlanRowShape, name: string): string {
  const value = requireField(row, name);
  if (typeof value !== "string") {
    throw new TypeError(`Result column "${name}" is not text.`);
  }
  return value;
}

export function optionalNumberField(
  row: PlanRowShape,
  name: string,
): number | null {
  const value = requireField(row, name);
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new TypeError(`Result column "${name}" is not numeric.`);
  }
  return value;
}

export function optionalStringField(
  row: PlanRowShape,
  name: string,
): string | null {
  const value = requireField(row, name);
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new TypeError(`Result column "${name}" is not text.`);
  }
  return value;
}

/** An output cell, already normalized away from booleans by the schema. */
export function outputValueField(
  row: PlanRowShape,
  name: string,
): LakeOutputValue {
  const value = requireField(row, name);
  if (typeof value === "boolean") {
    throw new TypeError(`Result column "${name}" was not normalized.`);
  }
  return value;
}
