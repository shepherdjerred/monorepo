import type { ReactNode } from "react";

export type SortDirection = "ascending" | "descending";

export type DataTableSortState = {
  readonly key: string;
  readonly direction: SortDirection;
};

export type DataTableColumn<T> = {
  readonly key: string;
  readonly header: string;
  readonly align?: "left" | "right" | undefined;
  readonly isRowHeader?: boolean | undefined;
  readonly render: (row: T) => ReactNode;
  readonly sortValue?:
    ((row: T) => string | number | null | undefined) | undefined;
  readonly exportValue?:
    ((row: T) => string | number | boolean | null | undefined) | undefined;
};

export type DataTableExportColumn<T> = {
  readonly key: string;
  readonly header: string;
  readonly value: (row: T) => string | number | boolean | null | undefined;
};

const TEXT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function normalizeSortScalar(
  raw: string | number | null | undefined,
): string | number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  return typeof raw === "number" && Number.isNaN(raw) ? null : raw;
}

/**
 * Sorts rows stably using `Intl.Collator` (`numeric: true, sensitivity: "base"`)
 * for strings and raw subtraction for numbers. `null` and `undefined` sort last
 * in both ascending and descending directions.
 */
export function sortDataTableRows<T>(
  rows: readonly T[],
  getValue: (row: T) => string | number | null | undefined,
  direction: SortDirection,
): T[] {
  const factor = direction === "ascending" ? 1 : -1;
  const decorated = rows.map((row, index) => ({
    row,
    index,
    value: normalizeSortScalar(getValue(row)),
  }));

  decorated.sort((left, right) => {
    if (left.value === null && right.value === null) {
      return left.index - right.index;
    }
    if (left.value === null) {
      return 1;
    }
    if (right.value === null) {
      return -1;
    }
    if (typeof left.value === "number" && typeof right.value === "number") {
      const diff = (left.value - right.value) * factor;
      return diff === 0 ? left.index - right.index : diff;
    }
    const cmp =
      TEXT_COLLATOR.compare(String(left.value), String(right.value)) * factor;
    return cmp === 0 ? left.index - right.index : cmp;
  });

  return decorated.map((entry) => entry.row);
}

function escapeCsvCell(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

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
  if (typeof rendered === "string") {
    return rendered;
  }
  if (typeof rendered === "number") {
    return rendered;
  }
  return typeof rendered === "boolean" ? rendered : null;
}

export function fallbackExportColumns<T>(
  columns: readonly DataTableColumn<T>[],
): DataTableExportColumn<T>[] {
  return columns.map((column) => ({
    key: column.key,
    header: column.header,
    value: (row) => {
      if (column.exportValue !== undefined) {
        return column.exportValue(row);
      }
      return column.sortValue === undefined
        ? scalarFromRendered(column.render(row))
        : column.sortValue(row);
    },
  }));
}
