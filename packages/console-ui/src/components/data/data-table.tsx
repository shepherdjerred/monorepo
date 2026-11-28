import { useId, useRef, useState, type ReactNode } from "react";
import type { RowData } from "@tanstack/react-table";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import { BulkBar } from "@shepherdjerred/console-ui/components/data/bulk-bar.tsx";
import {
  ContainerBody,
  PlainBody,
  WindowBody,
  type BodyProps,
} from "@shepherdjerred/console-ui/components/data/data-table-body.tsx";
import type {
  DataTableColumn,
  DataTableExportColumn,
  DataTableFilter,
} from "@shepherdjerred/console-ui/components/data/data-table-model.ts";
import {
  DataTableHead,
  type RowContext,
} from "@shepherdjerred/console-ui/components/data/data-table-parts.tsx";
import {
  useDataTableState,
  type DataTableStateProps,
} from "@shepherdjerred/console-ui/components/data/data-table-state.ts";
import { DataTableToolbar } from "@shepherdjerred/console-ui/components/data/data-table-toolbar.tsx";
import type { CountNoun } from "@shepherdjerred/console-ui/components/data/filter-bar.tsx";

export type DataTableProps<T extends RowData> = DataTableStateProps<T> & {
  readonly caption: string;
  readonly hideCaption?: boolean | undefined;
  /** The row's name in "Select …" and "Expand details for …"; the key by default. */
  readonly rowLabel?: ((row: T) => string) | undefined;
  readonly columns: readonly DataTableColumn<T>[];
  readonly searchPlaceholder?: string | undefined;
  /** View filters drawn as `Tabs`; the app applies them to `rows`. */
  readonly filters?: readonly DataTableFilter[] | undefined;
  /** The "of M" in the count when `rows` is already filtered by the app. */
  readonly totalCount?: number | undefined;
  readonly countNoun?: CountNoun | undefined;
  /** Either of these turns on "Copy CSV" and "Copy JSON". */
  readonly exportFilename?: string | undefined;
  readonly exportColumns?: readonly DataTableExportColumn<T>[] | undefined;
  readonly renderExpanded?: ((row: T) => ReactNode) | undefined;
  readonly emptyMessage?: string | undefined;
  /** A checkbox column with select-all. */
  readonly selectable?: boolean | undefined;
  /** Shows a `BulkBar` with these actions while rows are selected. */
  readonly bulkActions?: ((rows: readonly T[]) => ReactNode) | undefined;
  /** A sticky header row; on by default while virtualized against the page. */
  readonly sticky?: boolean | undefined;
  /** On a phone, rows become label/value lines instead of scrolling sideways. */
  readonly stack?: boolean | undefined;
};

function CapFooter({
  shown,
  total,
  cap,
  showAll,
  onToggle,
}: {
  readonly shown: number;
  readonly total: number;
  readonly cap: number;
  readonly showAll: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  return (
    <div className="ui-section-foot">
      {showAll
        ? `Showing all ${String(total)}`
        : `Showing ${String(shown)} of ${String(total)}`}
      <Button aria-expanded={showAll} onClick={onToggle}>
        {showAll ? `Show top ${String(cap)}` : "Show all"}
      </Button>
    </div>
  );
}

function Body<T extends RowData>({
  virtualized,
  maxHeight,
  scroller,
  ...props
}: BodyProps<T> & {
  readonly virtualized: boolean;
  readonly maxHeight: number | undefined;
  readonly scroller: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  if (!virtualized) {
    return <PlainBody {...props} />;
  }
  return maxHeight === undefined ? (
    <WindowBody {...props} />
  ) : (
    <ContainerBody {...props} scroller={scroller} />
  );
}

/**
 * The shared data table, on TanStack Table: sortable columns (`aria-sort`
 * on button headers), search, view filters, severity groups, row selection
 * with a bulk bar, expandable rows, "Showing N of M · Show all", copy as
 * CSV or JSON, j/k row navigation and, past 200 rows, TanStack Virtual. It
 * sits flush in a `Section`: no frame of its own.
 */
export function DataTable<T extends RowData>(
  props: DataTableProps<T>,
): React.JSX.Element {
  const { caption, columns, renderExpanded, selectable = false } = props;
  const baseId = useId();
  const captionId = `${baseId}-caption`;
  const scroller = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const state = useDataTableState(props);
  const { table, modelRows, display } = state;
  const maxHeight =
    typeof props.virtualize === "object"
      ? props.virtualize.maxHeight
      : undefined;

  const sticky = props.sticky ?? state.virtualized;
  const ctx: RowContext<T> = {
    columns,
    colCount:
      columns.length +
      (selectable ? 1 : 0) +
      (renderExpanded === undefined ? 0 : 1),
    selectable,
    expandable: renderExpanded !== undefined,
    baseId,
    currentKey: state.current,
    labelOf: (row, key) => props.rowLabel?.(row) ?? key,
    renderExpanded,
    groupBy: props.groupBy,
    onToggleGroup: state.toggleGroup,
  };
  const emptyText =
    modelRows.length > 0
      ? undefined
      : props.rows.length === 0
        ? (props.emptyMessage ?? "No items to display.")
        : "No matching rows.";

  return (
    <div
      ref={state.navigationRef}
      className="ui-datatable"
      // A head stuck to the page needs a box that does not scroll.
      data-page-sticky={maxHeight === undefined && sticky ? "" : undefined}
    >
      <span className="ui-sr-only" role="status">
        {announcement}
      </span>
      <DataTableToolbar
        caption={caption}
        query={state.query}
        onQueryChange={(query) => {
          table.setGlobalFilter(query);
          state.setShowAll(false);
        }}
        searchable={props.searchText !== undefined}
        searchPlaceholder={props.searchPlaceholder}
        filters={props.filters ?? []}
        shown={modelRows.map((row) => row.original)}
        total={props.totalCount ?? props.rows.length}
        countNoun={props.countNoun}
        columns={columns}
        exportFilename={props.exportFilename}
        exportColumns={props.exportColumns}
        announce={setAnnouncement}
      />
      <div
        ref={scroller}
        className="ui-table-scroll ui-datatable-scroll"
        data-contained={maxHeight === undefined ? undefined : ""}
        style={
          maxHeight === undefined
            ? undefined
            : { maxHeight: `${String(maxHeight)}px` }
        }
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
      >
        <table
          className="ui-table"
          data-sticky={sticky ? "" : undefined}
          data-stack={props.stack === true ? "" : undefined}
        >
          <caption
            id={captionId}
            className={props.hideCaption === true ? "ui-sr-only" : undefined}
          >
            {caption}
          </caption>
          <DataTableHead
            table={table}
            ctx={ctx}
            onSort={(column) => {
              const next =
                table.getColumn(column.key)?.getNextSortingOrder() ?? "asc";
              table.setSorting([{ id: column.key, desc: next === "desc" }]);
              setAnnouncement(
                `Sorted by ${column.header}, ${next === "desc" ? "descending" : "ascending"}, ${String(modelRows.length)} rows`,
              );
            }}
          />
          <Body
            items={display.items}
            ctx={ctx}
            emptyText={emptyText}
            scrollTo={state.scrollTo}
            virtualized={state.virtualized}
            maxHeight={maxHeight}
            scroller={scroller}
          />
        </table>
      </div>
      {state.isCapped ? (
        <CapFooter
          shown={display.shown}
          total={display.capTotal}
          cap={state.cap}
          showAll={state.showAll}
          onToggle={() => {
            state.setShowAll(!state.showAll);
          }}
        />
      ) : null}
      {props.bulkActions === undefined ? null : (
        <BulkBar
          count={state.selectedRows.length}
          actions={props.bulkActions(state.selectedRows)}
          onClear={state.clearSelection}
        />
      )}
    </div>
  );
}
