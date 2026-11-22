import {
  Children,
  isValidElement,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  formatSortAnnouncement,
  nextSortState,
  sortItems,
  type ClientSortState,
  type ColumnAccessor,
  type SortDirection,
} from "@shepherdjerred/storm-stats/client/sort.ts";
import { useAnnounce } from "@shepherdjerred/storm-stats/client/live-announcer.tsx";

type SortableThProps = {
  readonly label: string;
  readonly direction?: SortDirection | undefined;
  readonly numeric?: boolean | undefined;
  readonly onActivate: () => void;
};

function collectSortableHeaders(node: ReactNode, out: SortableThProps[]): void {
  for (const child of Children.toArray(node)) {
    if (isValidElement<SortableThProps>(child) && child.type === SortableTh) {
      out.push(child.props);
      continue;
    }
    if (
      isValidElement<{ readonly children?: ReactNode }>(child) &&
      child.props.children !== undefined
    ) {
      collectSortableHeaders(child.props.children, out);
    }
  }
}

export function ResponsiveTable({
  caption,
  compact = false,
  children,
}: {
  readonly caption: string;
  readonly compact?: boolean;
  readonly children: ReactNode;
}) {
  const captionId = useId();
  const sortSelectId = useId();
  const sortableHeaders: SortableThProps[] = [];
  collectSortableHeaders(children, sortableHeaders);
  const activeIndex = sortableHeaders.findIndex(
    (col) => col.direction !== undefined,
  );
  const activeCol = sortableHeaders.find((col) => col.direction !== undefined);

  return (
    <div
      tabIndex={0}
      role="region"
      aria-labelledby={captionId}
      className="table-wrapper"
    >
      {sortableHeaders.length > 0 ? (
        <div
          className={
            compact
              ? "table-mobile-sort table-mobile-sort-compact"
              : "table-mobile-sort"
          }
          role="group"
          aria-label={`Sort ${caption}`}
        >
          <label htmlFor={sortSelectId} className="mobile-sort-label">
            Sort
          </label>
          <select
            id={sortSelectId}
            className="mobile-sort-select"
            value={activeIndex === -1 ? "" : String(activeIndex)}
            onChange={(event) => {
              const chosen = sortableHeaders[Number(event.target.value)];
              chosen?.onActivate();
            }}
          >
            {activeIndex === -1 ? (
              <option value="" disabled>
                Choose column…
              </option>
            ) : null}
            {sortableHeaders.map((col, idx) => (
              <option key={col.label} value={String(idx)}>
                {col.label}
              </option>
            ))}
          </select>
          {activeCol === undefined ? null : (
            <button
              type="button"
              className="btn mobile-sort-dir-btn"
              onClick={activeCol.onActivate}
              aria-label={`Toggle ${activeCol.label} sort direction (currently ${activeCol.direction ?? "ascending"})`}
            >
              <SortIcon direction={activeCol.direction} />
              <span>
                {activeCol.direction === "ascending" ? "Asc" : "Desc"}
              </span>
            </button>
          )}
        </div>
      ) : null}
      <table
        className={compact ? "data-table data-table-compact" : "data-table"}
      >
        <caption id={captionId}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

function SortIcon({
  direction,
}: {
  readonly direction: SortDirection | undefined;
}) {
  if (direction === "ascending") {
    return <ArrowUp className="sort-indicator" aria-hidden="true" />;
  }
  return direction === "descending" ? (
    <ArrowDown className="sort-indicator" aria-hidden="true" />
  ) : (
    <ArrowUpDown className="sort-indicator" aria-hidden="true" />
  );
}

export function SortableTh({
  label,
  direction,
  numeric = false,
  onActivate,
}: SortableThProps) {
  return (
    <th
      scope="col"
      className={numeric ? "num-col" : undefined}
      aria-sort={direction}
    >
      <button type="button" onClick={onActivate}>
        <span>{label}</span>
        <SortIcon direction={direction} />
      </button>
    </th>
  );
}

export function useClientTableSort<T, K extends string>(options: {
  readonly rows: readonly T[];
  readonly initial: ClientSortState<NoInfer<K>> | null;
  readonly accessors: Readonly<Record<K, ColumnAccessor<T>>>;
  readonly labels: Readonly<Record<NoInfer<K>, string>>;
}) {
  const [sortState, setSortState] = useState<ClientSortState<K> | null>(
    options.initial,
  );
  const announce = useAnnounce();

  const sortedRows = useMemo(
    () => sortItems(options.rows, sortState, options.accessors),
    [options.rows, sortState, options.accessors],
  );

  function toggleColumn(column: K): void {
    const next = nextSortState(sortState, column);
    setSortState(next);
    announce(
      formatSortAnnouncement(
        options.labels[column],
        next.direction,
        options.rows.length,
      ),
    );
  }

  function directionFor(column: K): SortDirection | undefined {
    return sortState?.column === column ? sortState.direction : undefined;
  }

  function headerProps(column: K): {
    readonly direction: SortDirection | undefined;
    readonly onActivate: () => void;
  } {
    return {
      direction: directionFor(column),
      onActivate: () => {
        toggleColumn(column);
      },
    };
  }

  return {
    sortedRows,
    sortState,
    toggleColumn,
    directionFor,
    headerProps,
  };
}
