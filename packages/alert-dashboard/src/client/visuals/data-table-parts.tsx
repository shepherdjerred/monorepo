import { ChevronRightIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { DataTableColumn, SortDirection } from "./data-table-utils.ts";
import { Input } from "#components/input";

export type DataTableFilterOption = {
  readonly value: string;
  readonly label: string;
  readonly count?: number | undefined;
};

export type DataTableFilter = {
  readonly key: string;
  readonly label: string;
  readonly options: readonly DataTableFilterOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
};

export function SortGlyph({
  direction,
}: {
  readonly direction: SortDirection | "none";
}): React.JSX.Element {
  const symbol =
    direction === "ascending" ? "↑" : direction === "descending" ? "↓" : "↕";
  return (
    <span className="visual-sort-indicator" aria-hidden="true">
      {symbol}
    </span>
  );
}

export type TableToolbarProps = {
  readonly caption: string;
  readonly searchInputId: string;
  readonly searchEnabled: boolean;
  readonly searchPlaceholder: string;
  readonly query: string;
  readonly onQueryChange: (next: string) => void;
  readonly filters: readonly DataTableFilter[] | undefined;
  readonly canExport: boolean;
  readonly copiedFormat: "csv" | "json" | null;
  readonly onCopy: (format: "csv" | "json") => void;
};

export function TableToolbar(
  props: TableToolbarProps,
): React.JSX.Element | null {
  const {
    caption,
    searchInputId,
    searchEnabled,
    searchPlaceholder,
    query,
    onQueryChange,
    filters,
    canExport,
    copiedFormat,
    onCopy,
  } = props;
  const hasFilters = filters !== undefined && filters.length > 0;
  if (!searchEnabled && !hasFilters && !canExport) {
    return null;
  }
  return (
    <div className="visual-table-toolbar">
      {searchEnabled ? (
        <label htmlFor={searchInputId} className="visual-search">
          <span className="sr-only">{`Search ${caption}`}</span>
          <SearchIcon aria-hidden="true" />
          <Input
            id={searchInputId}
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => {
              onQueryChange(event.currentTarget.value);
            }}
          />
        </label>
      ) : null}
      {hasFilters ? (
        <div className="visual-filter-group">
          {filters.map((filter) => (
            <div
              key={filter.key}
              className="segmented visual-filter-pills"
              role="radiogroup"
              aria-label={filter.label}
            >
              {filter.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={option.value === filter.value}
                  onClick={() => {
                    filter.onChange(option.value);
                  }}
                >
                  {option.label}
                  {option.count === undefined ? null : (
                    <span className="segmented-count">{option.count}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {canExport ? (
        <div className="visual-export-group">
          {(["csv", "json"] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              className="button visual-export-btn"
              onClick={() => {
                onCopy(fmt);
              }}
            >
              {copiedFormat === fmt
                ? `Copied ${fmt.toUpperCase()}`
                : `Copy ${fmt.toUpperCase()}`}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DataTableRowPair<T>(props: {
  readonly row: T;
  readonly keyValue: string;
  readonly label: string;
  readonly baseId: string;
  readonly columns: readonly DataTableColumn<T>[];
  readonly renderExpanded: ((row: T) => ReactNode) | undefined;
  readonly expanded: boolean;
  readonly onToggleExpand: (key: string) => void;
}): React.JSX.Element {
  const {
    row,
    keyValue,
    label,
    baseId,
    columns,
    renderExpanded,
    expanded,
    onToggleExpand,
  } = props;
  const detailId = `${baseId}-exp-${keyValue.replaceAll(/[^\w-]/gu, "-")}`;
  const colCount = columns.length + (renderExpanded === undefined ? 0 : 1);

  return (
    <>
      <tr role="row">
        {renderExpanded === undefined ? null : (
          <td role="cell" className="visual-expand-cell" data-label="Details">
            <button
              type="button"
              className="visual-expand-btn"
              aria-expanded={expanded}
              aria-controls={detailId}
              aria-label={`${expanded ? "Collapse" : "Expand"} details for ${label}`}
              onClick={() => {
                onToggleExpand(keyValue);
              }}
            >
              <ChevronRightIcon aria-hidden="true" />
            </button>
          </td>
        )}
        {columns.map((column, colIdx) => {
          const isHeaderCell =
            column.isRowHeader === true ||
            (column.isRowHeader === undefined && colIdx === 0);
          const alignClass = column.align === "right" ? "num" : undefined;
          if (isHeaderCell) {
            return (
              <th
                key={column.key}
                scope="row"
                role="rowheader"
                data-label={column.header}
                className={alignClass}
              >
                {column.render(row)}
              </th>
            );
          }
          return (
            <td
              key={column.key}
              role="cell"
              data-label={column.header}
              className={alignClass}
            >
              {column.render(row)}
            </td>
          );
        })}
      </tr>
      {renderExpanded !== undefined && expanded ? (
        <tr id={detailId} role="row" className="visual-expanded-row">
          <td colSpan={colCount} role="cell" className="visual-expanded-cell">
            {renderExpanded(row)}
          </td>
        </tr>
      ) : null}
    </>
  );
}
