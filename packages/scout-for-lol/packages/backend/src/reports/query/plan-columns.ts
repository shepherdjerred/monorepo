import { match } from "ts-pattern";
import {
  formatReportDisplayValue,
  UNGROUPED_LABEL_COLUMN_LABEL,
  type ReportDisplayKind,
  type ReportResultColumn,
  type ReportValueFormat,
} from "@scout-for-lol/data";
import { scoutQlSourceCatalog } from "@scout-for-lol/data/model/scoutql/catalog/catalog-columns.ts";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";

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
    ? UNGROUPED_LABEL_COLUMN_LABEL
    : names.map((name) => columnLabel(name)).join(" • ");
}

export function planResultColumns(
  plan: ScoutQlPlan,
  columns: string[],
): ReportResultColumn[] {
  const catalog = scoutQlSourceCatalog(plan.source);
  const assetFor = (column: string) => {
    const info = catalog?.columns.get(column);
    // Name-backed virtual dimensions already contain display values. They do
    // not carry enough identity to safely resolve an icon (spell names such
    // as "Flash" can refer to multiple assets), so only identifier-backed
    // columns receive asset formatting metadata.
    return info?.type === "integer" || info?.type === "bigint"
      ? info.asset
      : undefined;
  };
  const groupingAsset = (index: number) => {
    const grouping = plan.groupings[index];
    return grouping?.kind === "column" ? assetFor(grouping.column) : undefined;
  };

  return columns.map((column) => {
    const output = plan.outputs.find((candidate) => candidate.name === column);
    const asset =
      column === LABEL_COLUMN
        ? undefined
        : output === undefined
          ? assetFor(column)
          : output.expr.kind === "grouping-ref"
            ? groupingAsset(output.expr.index)
            : undefined;
    return {
      key: column,
      label:
        column === LABEL_COLUMN
          ? planLabelColumnLabel(plan)
          : columnLabel(column),
      format: displayKindFormat(planDisplayKind(plan, column)),
      ...(asset === undefined ? {} : { asset }),
    };
  });
}

/** Render identifier-backed asset groupings before charts consume labels. */
export function planResultDimensions(
  plan: ScoutQlPlan,
  label: string,
  keys: LakeScalar[],
): string[] {
  if (plan.groupings.length === 0) return label.split(" • ");
  const catalog = scoutQlSourceCatalog(plan.source);
  const rendered = label.split(" • ");
  return plan.groupings.map((grouping, index) => {
    const key = keys[index];
    const info =
      grouping.kind === "column"
        ? catalog?.columns.get(grouping.column)
        : undefined;
    const asset =
      info?.type === "integer" || info?.type === "bigint"
        ? info.asset
        : undefined;
    return asset === undefined ||
      key === undefined ||
      key === null ||
      typeof key === "boolean"
      ? (rendered[index] ?? "")
      : formatReportDisplayValue(
          { key: grouping.name, label: grouping.name, format: "text", asset },
          key,
        );
  });
}
