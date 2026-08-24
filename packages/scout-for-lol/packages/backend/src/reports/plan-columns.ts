import { match } from "ts-pattern";
import type {
  ReportDisplayKind,
  ReportResultColumn,
  ReportValueFormat,
} from "@scout-for-lol/data";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";

/**
 * Result-column metadata for a ScoutQL v2 plan.
 *
 * The metric enum is gone, so a column's label and format are no longer looked
 * up in a registry: the plan states them. `plan.outputs[i].displayKind` is the
 * analyzer's inference (or the author's `RENDER … WITH (format = …)`
 * override), and the label is the output's own name — the author named it, so
 * echoing something else would be a rename nobody asked for.
 */

/** The hidden dimension column every result row carries. */
export const LABEL_COLUMN = "label";

export function planOutputNames(plan: ScoutQlPlan): string[] {
  return plan.outputs.map((output) => output.name);
}

export function planGroupingNames(plan: ScoutQlPlan): string[] {
  return plan.groupings.map((grouping) => grouping.name);
}

export function planResultColumnNames(plan: ScoutQlPlan): string[] {
  return [LABEL_COLUMN, ...planOutputNames(plan)];
}

export function planDisplayKind(
  plan: ScoutQlPlan,
  column: string,
): ReportDisplayKind {
  if (column === LABEL_COLUMN) return "text";
  const output = plan.outputs.find((candidate) => candidate.name === column);
  if (output === undefined) {
    throw new Error(`"${column}" is not an output of this query.`);
  }
  return output.displayKind;
}

/**
 * Display kinds are richer than the four wire formats the app and the Discord
 * table renderer understand, so durations and ratios render as decimals and
 * timestamps as text. Nothing is lost: the chart layer reads `displayKind`
 * directly from the plan and formats seconds as `34:12` itself.
 */
export function displayKindFormat(kind: ReportDisplayKind): ReportValueFormat {
  return match(kind)
    .with("count", (): ReportValueFormat => "integer")
    .with("percent", (): ReportValueFormat => "percent")
    .with("text", "timestamp", (): ReportValueFormat => "text")
    .with("decimal", "duration", "ratio", (): ReportValueFormat => "decimal")
    .exhaustive();
}

/** Title-case a snake_case output name for a human-facing header. */
export function columnLabel(column: string): string {
  return column
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/**
 * The header the joined dimension column deserves: the groupings that built
 * it, in order. A grand total has no dimension, so it keeps the neutral name.
 */
export function planLabelColumnLabel(plan: ScoutQlPlan): string {
  const names = planGroupingNames(plan);
  return names.length === 0
    ? "Label"
    : names.map((name) => columnLabel(name)).join(" • ");
}

export function planResultColumns(
  plan: ScoutQlPlan,
  columns: string[],
): ReportResultColumn[] {
  return columns.map((column) => ({
    key: column,
    label:
      column === LABEL_COLUMN
        ? planLabelColumnLabel(plan)
        : columnLabel(column),
    format: displayKindFormat(planDisplayKind(plan, column)),
  }));
}
