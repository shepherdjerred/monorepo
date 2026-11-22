import * as dataTableModule from "./data-table.tsx";
import * as metersModule from "./meters.tsx";
import * as sparklineModule from "./sparkline.tsx";
import * as stackTreeModule from "./stack-tree.tsx";
import * as statusMatrixModule from "./status-matrix.tsx";
import "#styles/visuals.css";

export type SparklineProps = sparklineModule.SparklineProps;

export type BudgetMeterProps = metersModule.BudgetMeterProps;
export type StackedMeterSegment = metersModule.StackedMeterSegment;
export type StackedMeterProps = metersModule.StackedMeterProps;

export type MatrixCellStatus = statusMatrixModule.MatrixCellStatus;
export type StatusMatrixCell = statusMatrixModule.StatusMatrixCell;
export type StatusMatrixColumn = statusMatrixModule.StatusMatrixColumn;
export type StatusMatrixRow = statusMatrixModule.StatusMatrixRow;
export type StatusMatrixProps = statusMatrixModule.StatusMatrixProps;

export type StackCheckState = stackTreeModule.StackCheckState;
export type StackReviewDecision = stackTreeModule.StackReviewDecision;
export type StackMergeableState = stackTreeModule.StackMergeableState;
export type StackPullRequest = stackTreeModule.StackPullRequest;
export type StackTreeProps = stackTreeModule.StackTreeProps;

export type SortDirection = dataTableModule.SortDirection;
export type DataTableColumn<T> = dataTableModule.DataTableColumn<T>;
export type DataTableExportColumn<T> = dataTableModule.DataTableExportColumn<T>;
export type DataTableProps<T> = dataTableModule.DataTableProps<T>;

export function Sparkline(props: SparklineProps): React.JSX.Element {
  return sparklineModule.Sparkline(props);
}

export function BudgetMeter(props: BudgetMeterProps): React.JSX.Element {
  return metersModule.BudgetMeter(props);
}

export function StackedMeter(props: StackedMeterProps): React.JSX.Element {
  return metersModule.StackedMeter(props);
}

export function StatusMatrix(props: StatusMatrixProps): React.JSX.Element {
  return statusMatrixModule.StatusMatrix(props);
}

export function StackTree(props: StackTreeProps): React.JSX.Element {
  return stackTreeModule.StackTree(props);
}

export function DataTable<T>(props: DataTableProps<T>): React.JSX.Element {
  return dataTableModule.DataTable(props);
}

export function sortDataTableRows<T>(
  rows: readonly T[],
  getValue: (row: T) => string | number | null | undefined,
  direction: SortDirection,
): T[] {
  return dataTableModule.sortDataTableRows(rows, getValue, direction);
}

export function formatDataTableCsv<T>(
  rows: readonly T[],
  columns: readonly DataTableExportColumn<T>[],
): string {
  return dataTableModule.formatDataTableCsv(rows, columns);
}

export function formatDataTableJson<T>(
  rows: readonly T[],
  columns: readonly DataTableExportColumn<T>[],
): string {
  return dataTableModule.formatDataTableJson(rows, columns);
}
