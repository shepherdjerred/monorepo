import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import * as tableParts from "./data-table-parts.tsx";
import * as tableUtils from "./data-table-utils.ts";

export type SortDirection = tableUtils.SortDirection;
export type DataTableSortState = tableUtils.DataTableSortState;
export type DataTableColumn<T> = tableUtils.DataTableColumn<T>;
export type DataTableExportColumn<T> = tableUtils.DataTableExportColumn<T>;
export type DataTableFilterOption = tableParts.DataTableFilterOption;
export type DataTableFilter = tableParts.DataTableFilter;

export type DataTableProps<T> = {
  readonly caption: string;
  readonly hideCaption?: boolean | undefined;
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly rowLabel?: ((row: T) => string) | undefined;
  readonly columns: readonly DataTableColumn<T>[];
  readonly defaultSort?: DataTableSortState | null | undefined;
  readonly searchPlaceholder?: string | undefined;
  readonly searchText?: ((row: T) => string) | undefined;
  readonly initialSearch?: string | undefined;
  readonly filters?: readonly DataTableFilter[] | undefined;
  readonly exportFilename?: string | undefined;
  readonly exportColumns?: readonly DataTableExportColumn<T>[] | undefined;
  readonly renderExpanded?: ((row: T) => ReactNode) | undefined;
  readonly initialExpandedKeys?: readonly string[] | undefined;
  readonly initialCap?: number | undefined;
  readonly emptyMessage?: string | undefined;
};

export function sortDataTableRows<T>(
  rows: readonly T[],
  getValue: (row: T) => string | number | null | undefined,
  direction: SortDirection,
): T[] {
  return tableUtils.sortDataTableRows(rows, getValue, direction);
}

export function formatDataTableCsv<T>(
  rows: readonly T[],
  columns: readonly DataTableExportColumn<T>[],
): string {
  return tableUtils.formatDataTableCsv(rows, columns);
}

export function formatDataTableJson<T>(
  rows: readonly T[],
  columns: readonly DataTableExportColumn<T>[],
): string {
  return tableUtils.formatDataTableJson(rows, columns);
}

/**
 * Reusable accessible data table with collated/numeric sorting, live status
 * announcements, optional search/filter/CSV-JSON copy toolbar, expandable row
 * drawers, bounded row cap, and `@container (max-width: 680px)` card stacking.
 */
export function DataTable<T>({
  caption,
  hideCaption = false,
  rows,
  rowKey,
  rowLabel,
  columns,
  defaultSort = null,
  searchPlaceholder = "Search…",
  searchText,
  initialSearch = "",
  filters,
  exportFilename,
  exportColumns,
  renderExpanded,
  initialExpandedKeys,
  initialCap = 25,
  emptyMessage = "No items to display.",
}: DataTableProps<T>): React.JSX.Element {
  const baseId = useId();
  const captionId = `${baseId}-caption`;
  const regionId = `${baseId}-region`;
  const searchInputId = `${baseId}-search`;

  const [sort, setSort] = useState<DataTableSortState | null>(defaultSort);
  const [query, setQuery] = useState(initialSearch);
  const [showAll, setShowAll] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () => new Set(initialExpandedKeys),
  );
  const [announcement, setAnnouncement] = useState("");
  const [copiedFormat, setCopiedFormat] = useState<"csv" | "json" | null>(null);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return searchText === undefined || needle.length === 0
      ? rows
      : rows.filter((row) => searchText(row).toLowerCase().includes(needle));
  }, [query, rows, searchText]);

  const sortedRows = useMemo(() => {
    if (sort === null) {
      return filteredRows;
    }
    const activeCol = columns.find((col) => col.key === sort.key);
    return activeCol?.sortValue === undefined
      ? filteredRows
      : tableUtils.sortDataTableRows(
          filteredRows,
          activeCol.sortValue,
          sort.direction,
        );
  }, [columns, filteredRows, sort]);

  const safeCap = Math.max(1, initialCap);
  const isCapped = sortedRows.length > safeCap;
  const visibleRows =
    isCapped && !showAll ? sortedRows.slice(0, safeCap) : sortedRows;
  const canExport = exportFilename !== undefined || exportColumns !== undefined;
  const colCount = columns.length + (renderExpanded === undefined ? 0 : 1);

  const handleSort = (column: DataTableColumn<T>) => {
    if (column.sortValue === undefined) {
      return;
    }
    const nextDirection: SortDirection =
      sort?.key === column.key && sort.direction === "ascending"
        ? "descending"
        : "ascending";
    setSort({ key: column.key, direction: nextDirection });
    setAnnouncement(
      `Sorted by ${column.header}, ${nextDirection}, ${String(filteredRows.length)} rows`,
    );
  };

  const handleCopy = (format: "csv" | "json") => {
    const resolvedCols =
      exportColumns ?? tableUtils.fallbackExportColumns(columns);
    const payload =
      format === "csv"
        ? tableUtils.formatDataTableCsv(sortedRows, resolvedCols)
        : tableUtils.formatDataTableJson(sortedRows, resolvedCols);
    if ("clipboard" in globalThis.navigator) {
      void globalThis.navigator.clipboard.writeText(payload);
    }
    setCopiedFormat(format);
    const targetName =
      exportFilename === undefined ? "" : ` (${exportFilename})`;
    setAnnouncement(
      `Copied ${String(sortedRows.length)} rows as ${format.toUpperCase()}${targetName}`,
    );
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const CapIcon = showAll ? ChevronUpIcon : ChevronDownIcon;

  return (
    <div className="visual-data-table">
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <tableParts.TableToolbar
        caption={caption}
        searchInputId={searchInputId}
        searchEnabled={searchText !== undefined}
        searchPlaceholder={searchPlaceholder}
        query={query}
        onQueryChange={(next) => {
          setQuery(next);
          setShowAll(false);
        }}
        filters={filters}
        canExport={canExport}
        copiedFormat={copiedFormat}
        onCopy={handleCopy}
      />
      <div
        id={regionId}
        className="visual-table-region"
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
      >
        <table className="visual-table" role="table">
          <caption
            id={captionId}
            className={hideCaption ? "sr-only" : "visual-table-caption"}
          >
            {caption}
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              {renderExpanded === undefined ? null : (
                <th
                  scope="col"
                  role="columnheader"
                  className="visual-expand-col"
                >
                  <span className="sr-only">Details</span>
                </th>
              )}
              {columns.map((column) => {
                const sortable = column.sortValue !== undefined;
                const activeDir: SortDirection | "none" =
                  sort?.key === column.key ? sort.direction : "none";
                const alignClass = column.align === "right" ? "num" : undefined;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    role="columnheader"
                    aria-sort={sortable ? activeDir : undefined}
                    className={alignClass}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className={`visual-sort-btn${alignClass === undefined ? "" : ` ${alignClass}`}`}
                        onClick={() => {
                          handleSort(column);
                        }}
                      >
                        <span>{column.header}</span>
                        <tableParts.SortGlyph direction={activeDir} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {visibleRows.length === 0 ? (
              <tr role="row" className="visual-empty-row">
                <td
                  colSpan={colCount}
                  role="cell"
                  className="visual-empty-cell"
                >
                  {rows.length === 0 ? emptyMessage : "No matching rows."}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const keyValue = rowKey(row);
                const label = rowLabel === undefined ? keyValue : rowLabel(row);
                return (
                  <tableParts.DataTableRowPair
                    key={keyValue}
                    row={row}
                    keyValue={keyValue}
                    label={label}
                    baseId={baseId}
                    columns={columns}
                    renderExpanded={renderExpanded}
                    expanded={expandedKeys.has(keyValue)}
                    onToggleExpand={toggleExpanded}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {isCapped ? (
        <button
          type="button"
          className="list-toggle visual-table-cap-toggle"
          aria-expanded={showAll}
          aria-controls={regionId}
          onClick={() => {
            setShowAll((previous) => !previous);
          }}
        >
          {showAll
            ? `Show top ${String(safeCap)}`
            : `Show all ${String(sortedRows.length)}`}
          <CapIcon aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
