import {
  formatReportDisplayValue,
  UNGROUPED_LABEL_COLUMN_LABEL,
  type ExploreMessage,
} from "@scout-for-lol/data";
import { ReportResultTable } from "#src/components/report-result-table.tsx";

/**
 * Is this an ungrouped result — one row describing everything, rather than one
 * row that happens to be the only member of a group?
 *
 * A query with no GROUP BY heads its dimension column with
 * {@link UNGROUPED_LABEL_COLUMN_LABEL}, so the check is derived from the same
 * constant the engine labels it from rather than from a literal. A grouped
 * query heads that column `Champion` or `Player` and never matches, which is
 * what keeps a single-champion result an ordinary table — its label carries
 * information, and a stat tile would drop it.
 */
export function isUngroupedResult(
  preview: NonNullable<ExploreMessage["preview"]>,
): boolean {
  return (
    preview.rows.length === 1 &&
    preview.columns.some(
      (column) =>
        column.key === "label" && column.label === UNGROUPED_LABEL_COLUMN_LABEL,
    )
  );
}

/**
 * One row of results, as figures rather than as a table.
 *
 * A scalar answer ("how many matches are in the data?") came back as a
 * full-width two-column table whose label column read `ALL` over a cell
 * reading `All` — a header row, a border and a degenerate dimension wrapped
 * around a single number.
 */
export function SingleRowResult(props: {
  preview: NonNullable<ExploreMessage["preview"]>;
}) {
  const row = props.preview.rows[0];
  if (row === undefined) {
    return null;
  }
  // The label column describes the grouping dimension, which a single
  // ungrouped row does not have; the value columns are the answer.
  const figures = props.preview.columns.flatMap((column) => {
    if (column.key === "label") {
      return [];
    }
    // A missing or null value means the column is absent for this row, which
    // is not a figure to display.
    const value = row.values.find(
      (entry) => entry.column === column.key,
    )?.value;
    return value === undefined || value === null
      ? []
      : [
          {
            // Two columns may share a display label; `key` is what actually
            // identifies the column, so it is what React must list on.
            key: column.key,
            label: column.label,
            text: formatReportDisplayValue(column, value),
          },
        ];
  });

  if (figures.length === 0) {
    return (
      <ReportResultTable
        columns={props.preview.columns}
        rows={props.preview.rows}
      />
    );
  }

  return (
    <dl className="flex flex-wrap gap-6 rounded-md border p-4">
      {figures.map((figure) => (
        <div key={figure.key} className="min-w-24">
          <dt className="text-xs text-muted-foreground">{figure.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{figure.text}</dd>
        </div>
      ))}
    </dl>
  );
}
