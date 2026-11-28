import { clsx } from "clsx";
import type { ReactNode, Ref } from "react";
import type { Row, RowData, Table } from "@tanstack/react-table";
import type {
  DataTableColumn,
  DisplayItem,
} from "@shepherdjerred/console-ui/components/data/data-table-model.ts";
import type { DataTableGroupBy } from "@shepherdjerred/console-ui/components/data/severity-buckets.ts";
import type { DataTableFeatures } from "@shepherdjerred/console-ui/components/data/data-table-features.ts";
import { StatusGlyph } from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

type DataRow<T extends RowData> = Row<DataTableFeatures, T>;
type DataTableInstance<T extends RowData> = Table<DataTableFeatures, T>;

/** What every body line needs to draw itself. */
export type RowContext<T> = {
  readonly columns: readonly DataTableColumn<T>[];
  readonly colCount: number;
  readonly selectable: boolean;
  readonly expandable: boolean;
  readonly baseId: string;
  readonly currentKey: string | undefined;
  readonly labelOf: (row: T, key: string) => string;
  readonly renderExpanded: ((row: T) => ReactNode) | undefined;
  readonly groupBy: DataTableGroupBy<T> | undefined;
  readonly onToggleGroup: (group: string) => void;
};

export function detailId(baseId: string, key: string): string {
  return `${baseId}-detail-${key.replaceAll(/[^\w-]/gu, "-")}`;
}

function Checkbox({
  label,
  checked,
  indeterminate = false,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly indeterminate?: boolean;
  readonly onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      className="ui-datatable-check"
      aria-label={label}
      checked={checked}
      ref={(element) => {
        if (element !== null) {
          element.indeterminate = indeterminate;
        }
      }}
      onChange={onChange}
    />
  );
}

function SortIcon({
  direction,
}: {
  readonly direction: false | "asc" | "desc";
}): React.JSX.Element {
  if (direction === false) {
    const Idle = ICONS.sortable;
    return <Idle className="ui-sort-idle" aria-hidden="true" />;
  }
  const Icon = direction === "asc" ? ICONS.sortAscending : ICONS.sortDescending;
  return <Icon aria-hidden="true" />;
}

const ARIA_SORT = {
  asc: "ascending",
  desc: "descending",
} as const;

/** The header row: select-all, the twist column, then sortable buttons. */
export function DataTableHead<T extends RowData>({
  table,
  ctx,
  onSort,
}: {
  readonly table: DataTableInstance<T>;
  readonly ctx: RowContext<T>;
  readonly onSort: (column: DataTableColumn<T>) => void;
}): React.JSX.Element {
  const all = ctx.selectable && table.getIsAllRowsSelected();
  const some = ctx.selectable && table.getIsSomeRowsSelected();
  return (
    <thead>
      <tr>
        {ctx.selectable ? (
          <th scope="col" className="ui-datatable-select">
            <Checkbox
              label="Select all rows"
              checked={all}
              indeterminate={some && !all}
              onChange={(event) => {
                table.toggleAllRowsSelected(event.currentTarget.checked);
              }}
            />
          </th>
        ) : null}
        {ctx.expandable ? (
          <th scope="col" className="ui-datatable-twist">
            <span className="ui-sr-only">Details</span>
          </th>
        ) : null}
        {ctx.columns.map((column) => {
          const numeric = column.align === "right";
          if (column.sortValue === undefined) {
            return (
              <th
                key={column.key}
                scope="col"
                className={numeric ? "ui-num" : undefined}
              >
                {column.header}
              </th>
            );
          }
          const direction = table.getColumn(column.key)?.getIsSorted() ?? false;
          return (
            <th
              key={column.key}
              scope="col"
              className={numeric ? "ui-num" : undefined}
              aria-sort={direction === false ? "none" : ARIA_SORT[direction]}
            >
              <button
                type="button"
                className="ui-sort"
                onClick={() => {
                  onSort(column);
                }}
              >
                <span>{column.header}</span>
                <SortIcon direction={direction} />
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

function GroupRow<T extends RowData>({
  item,
  ctx,
  measure,
  index,
}: {
  readonly item: Extract<DisplayItem<DataRow<T>>, { kind: "group" }>;
  readonly ctx: RowContext<T>;
  readonly measure: Ref<HTMLTableRowElement> | undefined;
  readonly index: number;
}): React.JSX.Element {
  const label = ctx.groupBy?.label?.(item.group) ?? item.group;
  const severity = ctx.groupBy?.severity?.(item.group);
  const Twist = item.open ? ICONS.collapse : ICONS.expand;
  return (
    <tr className="ui-table-group" ref={measure} data-index={index}>
      <th scope="colgroup" colSpan={ctx.colCount}>
        <button
          type="button"
          className="ui-twist"
          aria-expanded={item.open}
          aria-label={`${item.open ? "Collapse" : "Expand"} ${label}`}
          onClick={() => {
            ctx.onToggleGroup(item.group);
          }}
        >
          <Twist aria-hidden="true" />
        </button>
        {severity === undefined ? (
          label
        ) : (
          <StatusGlyph severity={severity} label={label} />
        )}
        <span className="ui-count">{item.count}</span>
      </th>
    </tr>
  );
}

function DataCells<T extends RowData>({
  row,
  ctx,
}: {
  readonly row: T;
  readonly ctx: RowContext<T>;
}): React.JSX.Element {
  return (
    <>
      {ctx.columns.map((column, index) => {
        const header =
          column.isRowHeader === true ||
          (column.isRowHeader === undefined && index === 0);
        const className = clsx(
          column.align === "right" && "ui-num",
          column.fill === true && "ui-fill",
        );
        const content =
          column.fill === true ? (
            <span className="ui-truncate">{column.render(row)}</span>
          ) : (
            column.render(row)
          );
        return header ? (
          <th
            key={column.key}
            scope="row"
            className={className || undefined}
            data-label={index === 0 ? undefined : column.header}
          >
            {content}
          </th>
        ) : (
          <td
            key={column.key}
            className={className || undefined}
            data-label={column.header}
          >
            {content}
          </td>
        );
      })}
    </>
  );
}

function DataRowLine<T extends RowData>({
  row,
  ctx,
  measure,
  index,
}: {
  readonly row: DataRow<T>;
  readonly ctx: RowContext<T>;
  readonly measure: Ref<HTMLTableRowElement> | undefined;
  readonly index: number;
}): React.JSX.Element {
  const label = ctx.labelOf(row.original, row.id);
  const current = ctx.currentKey === row.id;
  const selected = ctx.selectable && row.getIsSelected();
  const expanded = ctx.expandable && row.getIsExpanded();
  const Twist = expanded ? ICONS.collapse : ICONS.expand;
  return (
    <tr
      ref={measure}
      data-index={index}
      data-key={row.id}
      data-current={current ? "" : undefined}
      data-selected={selected ? "" : undefined}
      aria-current={current ? "true" : undefined}
    >
      {ctx.selectable ? (
        <td className="ui-datatable-select" data-label="Select">
          <Checkbox
            label={`Select ${label}`}
            checked={selected}
            onChange={row.getToggleSelectedHandler()}
          />
        </td>
      ) : null}
      {ctx.expandable ? (
        <td className="ui-datatable-twist" data-label="Details">
          <button
            type="button"
            className="ui-twist"
            aria-expanded={expanded}
            aria-controls={expanded ? detailId(ctx.baseId, row.id) : undefined}
            aria-label={`${expanded ? "Collapse" : "Expand"} details for ${label}`}
            onClick={() => {
              row.toggleExpanded();
            }}
          >
            <Twist aria-hidden="true" />
          </button>
        </td>
      ) : null}
      <DataCells row={row.original} ctx={ctx} />
    </tr>
  );
}

/** One body line: a group heading, a data row, or a row's detail. */
export function BodyLine<T extends RowData>({
  item,
  ctx,
  index,
  measure,
}: {
  readonly item: DisplayItem<DataRow<T>>;
  readonly ctx: RowContext<T>;
  readonly index: number;
  readonly measure?: Ref<HTMLTableRowElement> | undefined;
}): React.JSX.Element {
  if (item.kind === "group") {
    return <GroupRow item={item} ctx={ctx} measure={measure} index={index} />;
  }
  if (item.kind === "row") {
    return (
      <DataRowLine row={item.row} ctx={ctx} measure={measure} index={index} />
    );
  }
  return (
    <tr
      id={detailId(ctx.baseId, item.key)}
      className="ui-table-child ui-datatable-detail"
      ref={measure}
      data-index={index}
    >
      <td colSpan={ctx.colCount}>{ctx.renderExpanded?.(item.row.original)}</td>
    </tr>
  );
}

/** A full-width line holding the place of rows the virtualizer skipped. */
export function SpacerRow({
  height,
  colCount,
}: {
  readonly height: number;
  readonly colCount: number;
}): React.JSX.Element | null {
  if (height <= 0) {
    return null;
  }
  return (
    <tr className="ui-datatable-spacer" aria-hidden="true">
      <td colSpan={colCount} style={{ height: `${String(height)}px` }} />
    </tr>
  );
}
