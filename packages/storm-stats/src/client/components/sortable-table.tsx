import { useId, useMemo, useState, type ReactNode } from "react";
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
  return (
    <div
      tabIndex={0}
      role="region"
      aria-labelledby={captionId}
      className="table-wrapper"
    >
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
}: {
  readonly label: string;
  readonly direction?: SortDirection | undefined;
  readonly numeric?: boolean | undefined;
  readonly onActivate: () => void;
}) {
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
