import type { ReportDisplayKind } from "#src/model/reports/report.ts";

/**
 * The shape of one ScoutQL column, and the helper that builds a computed one.
 *
 * Its own module so the catalog and the tables of computed columns can both
 * depend on it without depending on each other.
 */

export type ScoutQlColumnType =
  "varchar" | "integer" | "bigint" | "double" | "boolean" | "timestamp";

export type ScoutQlColumnContexts = {
  /** Usable inside SELECT expressions (aggregate arguments, echoes). */
  select: boolean;
  /** Usable in WHERE / FILTER predicates. */
  where: boolean;
  /** Usable as a GROUP BY dimension. */
  groupBy: boolean;
};

export type ScoutQlColumnInfo = {
  name: string;
  type: ScoutQlColumnType;
  description: string;
  /** Display kind of the RAW column (aggregates over it may inherit it). */
  displayKind: ReportDisplayKind;
  /** Computed by the engine (dimension), not a physical lake column. */
  virtual: boolean;
  contexts: ScoutQlColumnContexts;
};

export const ALL_CONTEXTS: ScoutQlColumnContexts = {
  select: true,
  where: true,
  groupBy: true,
};

export function virtualColumn(
  name: string,
  type: ScoutQlColumnType,
  description: string,
  contexts: ScoutQlColumnContexts = ALL_CONTEXTS,
): ScoutQlColumnInfo {
  return {
    name,
    type,
    description,
    displayKind: "text",
    virtual: true,
    contexts,
  };
}
