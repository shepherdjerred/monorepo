export type SortDirection = "ascending" | "descending";

export type ClientSortState<K extends string> = {
  readonly column: K;
  readonly direction: SortDirection;
};

export type ColumnAccessor<T> =
  | { readonly kind: "number"; readonly getValue: (row: T) => number }
  | { readonly kind: "text"; readonly getValue: (row: T) => string };

const TEXT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function nextSortState<K extends string>(
  current: ClientSortState<K> | null,
  clickedColumn: K,
): ClientSortState<K> {
  if (current?.column === clickedColumn) {
    return {
      column: clickedColumn,
      direction: current.direction === "ascending" ? "descending" : "ascending",
    };
  }
  return {
    column: clickedColumn,
    direction: "ascending",
  };
}

export function sortItems<T, K extends string>(
  items: readonly T[],
  state: ClientSortState<K> | null,
  accessors: Readonly<Record<K, ColumnAccessor<T>>>,
): T[] {
  const copy = [...items];
  if (state === null) {
    return copy;
  }
  const accessor = accessors[state.column];
  const factor = state.direction === "ascending" ? 1 : -1;

  if (accessor.kind === "number") {
    const decorated = copy.map((item) => ({
      item,
      value: accessor.getValue(item),
    }));
    decorated.sort((left, right) => factor * (left.value - right.value));
    return decorated.map((entry) => entry.item);
  }

  const decorated = copy.map((item) => ({
    item,
    value: accessor.getValue(item),
  }));
  decorated.sort(
    (left, right) => factor * TEXT_COLLATOR.compare(left.value, right.value),
  );
  return decorated.map((entry) => entry.item);
}

export function formatSortAnnouncement(
  columnLabel: string,
  direction: SortDirection,
  rowCount: number,
): string {
  const noun = rowCount === 1 ? "row" : "rows";
  return `Sorted by ${columnLabel}, ${direction}, ${String(rowCount)} ${noun}`;
}
