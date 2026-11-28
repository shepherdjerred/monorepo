import type { ReactNode } from "react";
import {
  bucketBySeverity,
  type DataTableGroupBy,
} from "@shepherdjerred/console-ui/components/data/severity-buckets.ts";

export type SortDirection = "ascending" | "descending";

export type DataTableSortState = {
  readonly key: string;
  readonly direction: SortDirection;
};

export type SortScalar = string | number | null | undefined;
export type ExportScalar = string | number | boolean | null | undefined;

export type DataTableColumn<T> = {
  readonly key: string;
  readonly header: string;
  /** `right` draws the column as mono, right-aligned figures. */
  readonly align?: "left" | "right" | undefined;
  /** Defaults to the first column. */
  readonly isRowHeader?: boolean | undefined;
  /** The cell takes the remaining width and cuts its text with an ellipsis. */
  readonly fill?: boolean | undefined;
  readonly render: (row: T) => ReactNode;
  /** Makes the column sortable; null, undefined and NaN sort last both ways. */
  readonly sortValue?: ((row: T) => SortScalar) | undefined;
  readonly exportValue?: ((row: T) => ExportScalar) | undefined;
};

export type DataTableExportColumn<T> = {
  readonly key: string;
  readonly header: string;
  readonly value: (row: T) => ExportScalar;
};

export type DataTableFilterOption = {
  readonly value: string;
  readonly label: string;
  readonly count?: number | undefined;
};

/** A view filter drawn as console-ui `Tabs`; the app filters `rows` itself. */
export type DataTableFilter = {
  readonly key: string;
  readonly label: string;
  readonly options: readonly DataTableFilterOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The unfiltered choice "Clear filters" returns to; the first option by default. */
  readonly defaultValue?: string | undefined;
};

const TEXT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** null, undefined and NaN become `undefined`, which sorts last. */
export function normalizeSortScalar(
  raw: SortScalar,
): string | number | undefined {
  return raw === undefined || raw === null || Number.isNaN(raw)
    ? undefined
    : raw;
}

/** Ascending comparison: numbers by value, text numeric-aware and case-blind. */
export function compareSortScalars(
  left: string | number,
  right: string | number,
): number {
  return typeof left === "number" && typeof right === "number"
    ? left - right
    : TEXT_COLLATOR.compare(String(left), String(right));
}

/**
 * Sorts rows stably with the DataTable's comparison. `null` and `undefined`
 * sort last in both directions.
 */
export function sortDataTableRows<T>(
  rows: readonly T[],
  getValue: (row: T) => SortScalar,
  direction: SortDirection,
): T[] {
  const factor = direction === "ascending" ? 1 : -1;
  const decorated = rows.map((row, index) => ({
    row,
    index,
    value: normalizeSortScalar(getValue(row)),
  }));
  decorated.sort((left, right) => {
    if (left.value === undefined || right.value === undefined) {
      if (left.value === right.value) return left.index - right.index;
      return left.value === undefined ? 1 : -1;
    }
    const cmp = compareSortScalars(left.value, right.value) * factor;
    return cmp === 0 ? left.index - right.index : cmp;
  });
  return decorated.map((entry) => entry.row);
}

function escapeCsvCell(value: ExportScalar): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 CSV: a header line, then one line per row. */
export function formatDataTableCsv<T>(
  rows: readonly T[],
  columns: readonly DataTableExportColumn<T>[],
): string {
  const headerLine = columns
    .map((column) => escapeCsvCell(column.header))
    .join(",");
  const bodyLines = rows.map((row) =>
    columns.map((column) => escapeCsvCell(column.value(row))).join(","),
  );
  return [headerLine, ...bodyLines].join("\n");
}

/** A JSON array of `{ [column.key]: value }` records. */
export function formatDataTableJson<T>(
  rows: readonly T[],
  columns: readonly DataTableExportColumn<T>[],
): string {
  const records = rows.map((row) => {
    const entry: Record<string, string | number | boolean | null> = {};
    for (const column of columns) {
      entry[column.key] = column.value(row) ?? null;
    }
    return entry;
  });
  return JSON.stringify(records, null, 2);
}

function scalarFromRendered(
  rendered: ReactNode,
): string | number | boolean | null {
  switch (typeof rendered) {
    case "string":
    case "number":
    case "boolean": {
      return rendered;
    }
    case "bigint":
    case "function":
    case "object":
    case "symbol":
    case "undefined": {
      return null;
    }
  }
}

/** Export columns from the table's columns: `exportValue`, else `sortValue`, else plain rendered text. */
export function fallbackExportColumns<T>(
  columns: readonly DataTableColumn<T>[],
): DataTableExportColumn<T>[] {
  return columns.map((column) => ({
    key: column.key,
    header: column.header,
    value: (row) => {
      if (column.exportValue !== undefined) return column.exportValue(row);
      return column.sortValue === undefined
        ? scalarFromRendered(column.render(row))
        : column.sortValue(row);
    },
  }));
}

/** One line of the table body, in display order. */
export type DisplayItem<T> =
  | {
      readonly kind: "group";
      readonly key: string;
      readonly group: string;
      readonly count: number;
      readonly open: boolean;
    }
  | { readonly kind: "row"; readonly key: string; readonly row: T }
  | { readonly kind: "detail"; readonly key: string; readonly row: T };

export type DisplayModel<T> = {
  readonly items: readonly DisplayItem<T>[];
  /** Keys of the data rows on screen, in order (for j/k navigation). */
  readonly rowKeys: readonly string[];
  /** Data rows shown (after the cap and collapsed groups). */
  readonly shown: number;
  /** Data rows the cap applies to (collapsed groups excluded). */
  readonly capTotal: number;
};

export type DisplayOptions<T> = {
  readonly rowKey: (row: T) => string;
  readonly groupBy?: DataTableGroupBy<T> | undefined;
  readonly collapsed: ReadonlySet<string>;
  readonly isExpanded: (key: string) => boolean;
  readonly cap: number;
};

/**
 * Lays filtered, sorted rows out as body lines: group headings worst first
 * (rows keep their sorted order inside a group), each row followed by its
 * detail line when expanded, at most `cap` rows outside collapsed groups.
 */
export function buildDisplayModel<T>(
  rows: readonly T[],
  options: DisplayOptions<T>,
): DisplayModel<T> {
  const { rowKey, groupBy, collapsed, isExpanded, cap } = options;
  const groups: readonly [string | undefined, T[]][] =
    groupBy === undefined
      ? [[undefined, [...rows]]]
      : bucketBySeverity(rows, groupBy.value, groupBy.rank);
  const capTotal = groups
    .filter(([group]) => group === undefined || !collapsed.has(group))
    .reduce((sum, [, members]) => sum + members.length, 0);
  const items: DisplayItem<T>[] = [];
  const rowKeys: string[] = [];
  let budget = cap;
  for (const [group, members] of groups) {
    const open = group === undefined || !collapsed.has(group);
    if (group !== undefined) {
      if (open && budget <= 0) {
        break;
      }
      items.push({
        kind: "group",
        key: `group:${group}`,
        group,
        count: members.length,
        open,
      });
    }
    if (!open) continue;
    for (const row of members.slice(0, Math.max(budget, 0))) {
      const key = rowKey(row);
      rowKeys.push(key);
      items.push({ kind: "row", key, row });
      if (isExpanded(key)) items.push({ kind: "detail", key, row });
    }
    budget -= members.length;
  }
  return { items, rowKeys, shown: rowKeys.length, capTotal };
}
