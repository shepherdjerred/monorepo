import { useMemo, useRef, useState, type RefCallback } from "react";
import {
  functionalUpdate,
  useTable,
  type ColumnDef,
  type ExpandedState,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import type { ScrollToItem } from "@shepherdjerred/console-ui/components/data/data-table-body.tsx";
import {
  dataTableFeatures,
  type DataTableFeatures,
} from "@shepherdjerred/console-ui/components/data/data-table-features.ts";
import {
  buildDisplayModel,
  compareSortScalars,
  normalizeSortScalar,
  type DataTableColumn,
  type DataTableSortState,
  type DisplayModel,
} from "@shepherdjerred/console-ui/components/data/data-table-model.ts";
import { useRowNavigation } from "@shepherdjerred/console-ui/components/data/row-navigation.ts";
import type { DataTableGroupBy } from "@shepherdjerred/console-ui/components/data/severity-buckets.ts";

type DataRow<T extends RowData> = Row<DataTableFeatures, T>;

export const VIRTUALIZE_THRESHOLD = 200;
const SEARCH_COLUMN = "__search";
const NO_GROUPS: ReadonlySet<string> = new Set();

/** The props the table state reads; `DataTableProps` adds rendering ones. */
export type DataTableStateProps<T extends RowData> = {
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly columns: readonly DataTableColumn<T>[];
  readonly defaultSort?: DataTableSortState | null | undefined;
  readonly searchText?: ((row: T) => string) | undefined;
  readonly initialSearch?: string | undefined;
  readonly renderExpanded?: ((row: T) => unknown) | undefined;
  readonly initialExpandedKeys?: readonly string[] | undefined;
  readonly initialCap?: number | undefined;
  readonly groupBy?: DataTableGroupBy<T> | undefined;
  readonly selectedKeys?: readonly string[] | undefined;
  readonly onSelectionChange?:
    ((keys: readonly string[], rows: readonly T[]) => void) | undefined;
  readonly virtualize?: boolean | { readonly maxHeight: number } | undefined;
  readonly currentRowKey?: string | undefined;
  readonly onCurrentRowChange?: ((key: string) => void) | undefined;
  readonly keyboardNavigation?: boolean | undefined;
  readonly onRowOpen?: ((row: T) => void) | undefined;
};

function toSorting(sort: DataTableSortState | null | undefined): SortingState {
  return sort === null || sort === undefined
    ? []
    : [{ id: sort.key, desc: sort.direction === "descending" }];
}

function toSelection(keys: readonly string[]): RowSelectionState {
  const state: RowSelectionState = {};
  for (const key of keys) {
    state[key] = true;
  }
  return state;
}

function useColumnDefs<T extends RowData>(
  columns: readonly DataTableColumn<T>[],
  searchText: ((row: T) => string) | undefined,
): ColumnDef<DataTableFeatures, T>[] {
  return useMemo(() => {
    const defs: ColumnDef<DataTableFeatures, T>[] = columns.map((column) => {
      const { sortValue } = column;
      if (sortValue === undefined) {
        return { id: column.key, enableSorting: false };
      }
      return {
        id: column.key,
        accessorFn: (row: T) => normalizeSortScalar(sortValue(row)),
        sortUndefined: "last",
        sortFn: (left, right, id) =>
          compareSortScalars(
            left.getValue<string | number>(id),
            right.getValue<string | number>(id),
          ),
      };
    });
    if (searchText !== undefined) {
      defs.push({
        id: SEARCH_COLUMN,
        accessorFn: (row: T) => searchText(row).toLowerCase(),
        enableSorting: false,
      });
    }
    return defs;
  }, [columns, searchText]);
}

/** Selection owned by the table, or by the caller through `selectedKeys`. */
function useSelection<T extends RowData>(
  props: DataTableStateProps<T>,
  byKey: ReadonlyMap<string, T>,
): {
  readonly rowSelection: RowSelectionState;
  readonly selectedRows: readonly T[];
  readonly changeSelection: (updater: Updater<RowSelectionState>) => void;
} {
  const { selectedKeys, onSelectionChange } = props;
  const [own, setOwn] = useState<RowSelectionState>({});
  const rowSelection = useMemo(
    () => (selectedKeys === undefined ? own : toSelection(selectedKeys)),
    [own, selectedKeys],
  );
  const rowsOf = (keys: readonly string[]): T[] =>
    keys.flatMap((key) => {
      const row = byKey.get(key);
      return row === undefined ? [] : [row];
    });
  return {
    rowSelection,
    selectedRows: rowsOf(Object.keys(rowSelection)),
    changeSelection: (updater) => {
      const next = functionalUpdate(updater, rowSelection);
      if (selectedKeys === undefined) {
        setOwn(next);
      }
      const keys = Object.keys(next);
      onSelectionChange?.(keys, rowsOf(keys));
    },
  };
}

function useDisplay<T extends RowData>(
  modelRows: readonly DataRow<T>[],
  options: {
    readonly groupBy: DataTableGroupBy<T> | undefined;
    readonly expanded: ExpandedState;
    readonly virtualized: boolean;
    readonly initialCap: number;
  },
): {
  readonly display: DisplayModel<DataRow<T>>;
  readonly cap: number;
  readonly isCapped: boolean;
  readonly showAll: boolean;
  readonly setShowAll: (next: boolean) => void;
  readonly toggleGroup: (group: string) => void;
} {
  const { groupBy, expanded, virtualized, initialCap } = options;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_GROUPS);
  const [showAll, setShowAll] = useState(false);
  const cap = virtualized ? Infinity : Math.max(1, initialCap);
  const display = buildDisplayModel<DataRow<T>>(modelRows, {
    rowKey: (row) => row.id,
    groupBy:
      groupBy === undefined
        ? undefined
        : { ...groupBy, value: (row) => groupBy.value(row.original) },
    collapsed,
    isExpanded: (key) => expanded === true || expanded[key] === true,
    cap: showAll ? Infinity : cap,
  });
  return {
    display,
    cap,
    isCapped: !virtualized && display.capTotal > cap,
    showAll,
    setShowAll,
    toggleGroup: (group) => {
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (!next.delete(group)) {
          next.add(group);
        }
        return next;
      });
    },
  };
}

/**
 * Everything a `DataTable` knows: the TanStack Table instance (sorting,
 * search as a global filter, selection, expansion), the laid-out body lines,
 * the cap, and the current row with its j/k navigation.
 */
export function useDataTableState<T extends RowData>(
  props: DataTableStateProps<T>,
) {
  const { rows, rowKey, columns, searchText, groupBy } = props;
  const scrollTo = useRef<ScrollToItem>(null);
  const [sorting, setSorting] = useState(() => toSorting(props.defaultSort));
  const [query, setQuery] = useState(props.initialSearch ?? "");
  const [expanded, setExpanded] = useState<ExpandedState>(() =>
    toSelection(props.initialExpandedKeys ?? []),
  );
  const [ownCurrent, setOwnCurrent] = useState<string | undefined>();
  const byKey = useMemo(
    () => new Map(rows.map((row) => [rowKey(row), row])),
    [rows, rowKey],
  );
  const selection = useSelection(props, byKey);

  const table = useTable({
    features: dataTableFeatures,
    columns: useColumnDefs(columns, searchText),
    data: rows,
    getRowId: (row) => rowKey(row),
    state: {
      sorting,
      globalFilter: query,
      rowSelection: selection.rowSelection,
      expanded,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    onRowSelectionChange: selection.changeSelection,
    onExpandedChange: setExpanded,
    enableSortingRemoval: false,
    enableMultiSort: false,
    sortDescFirst: false,
    getRowCanExpand: () => props.renderExpanded !== undefined,
    getColumnCanGlobalFilter: (column) => column.id === SEARCH_COLUMN,
    globalFilterFn: (row, id, value: string) =>
      row.getValue<string>(id).includes(value.trim().toLowerCase()),
  });

  const modelRows = table.getRowModel().rows;
  const virtualized =
    props.virtualize !== undefined &&
    props.virtualize !== false &&
    modelRows.length > VIRTUALIZE_THRESHOLD;
  const layout = useDisplay(modelRows, {
    groupBy,
    expanded,
    virtualized,
    initialCap: props.initialCap ?? 25,
  });

  const current = props.currentRowKey ?? ownCurrent;
  const navigationRef: RefCallback<HTMLElement> = useRowNavigation({
    keys: layout.display.rowKeys,
    current,
    onChange: (key) => {
      setOwnCurrent(key);
      props.onCurrentRowChange?.(key);
      const index = layout.display.items.findIndex(
        (item) => item.kind === "row" && item.key === key,
      );
      if (index !== -1) {
        scrollTo.current?.(index);
      }
    },
    onOpen: (key) => {
      const row = byKey.get(key);
      if (row !== undefined) {
        props.onRowOpen?.(row);
      }
    },
    enabled: props.keyboardNavigation === true,
  });

  return {
    table,
    query,
    modelRows,
    virtualized,
    current,
    scrollTo,
    navigationRef,
    selectedRows: selection.selectedRows,
    clearSelection: () => {
      selection.changeSelection({});
    },
    ...layout,
  };
}
