import type { ReactNode } from "react";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import { SearchField } from "@shepherdjerred/console-ui/components/search-field.tsx";

export type CountNoun = { readonly one: string; readonly other: string };

const ROWS: CountNoun = { one: "row", other: "rows" };

/** "143 alerts" when nothing is hidden, otherwise "12 of 143 alerts". */
export function describeCount(
  shown: number,
  total: number,
  noun: CountNoun = ROWS,
): string {
  const word = total === 1 ? noun.one : noun.other;
  return shown === total
    ? `${String(total)} ${word}`
    : `${String(shown)} of ${String(total)} ${word}`;
}

export type FilterState = {
  readonly search?: string | undefined;
  readonly filters?:
    | readonly { readonly value: string; readonly defaultValue: string }[]
    | undefined;
};

/** True when a search is typed or any filter is off its default. */
export function filtersActive({
  search = "",
  filters = [],
}: FilterState): boolean {
  return (
    search.trim().length > 0 ||
    filters.some((filter) => filter.value !== filter.defaultValue)
  );
}

export type FilterBarSearch = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Accessible name, e.g. "Filter alerts". */
  readonly label: string;
  readonly placeholder?: string | undefined;
};

export type FilterBarProps = {
  readonly search?: FilterBarSearch | undefined;
  /** `Tabs` or a select for view filters. */
  readonly filters?: ReactNode;
  /** The "N of M" count, announced politely as it changes. */
  readonly count?:
    | {
        readonly shown: number;
        readonly total: number;
        readonly noun?: CountNoun | undefined;
      }
    | undefined;
  /** Shows "Clear filters" while true (see `filtersActive`). */
  readonly active?: boolean | undefined;
  readonly onClear?: (() => void) | undefined;
  /** Right-aligned controls, e.g. export buttons. */
  readonly end?: ReactNode;
};

/**
 * The toolbar row above a list: search, view filters, the "N of M" count,
 * "Clear filters" while anything is filtered, and controls at the end.
 */
export function FilterBar({
  search,
  filters,
  count,
  active = false,
  onClear,
  end,
}: FilterBarProps): React.JSX.Element {
  return (
    <div className="ui-toolbar ui-filterbar">
      {search === undefined ? null : (
        <SearchField
          label={search.label}
          placeholder={search.placeholder ?? "Filter…"}
          value={search.value}
          onChange={(event) => {
            search.onChange(event.currentTarget.value);
          }}
        />
      )}
      {filters === undefined ? null : (
        <div className="ui-filterbar-filters">{filters}</div>
      )}
      {count === undefined ? null : (
        <span className="ui-filterbar-count" role="status">
          {describeCount(count.shown, count.total, count.noun)}
        </span>
      )}
      {active && onClear !== undefined ? (
        <Button onClick={onClear}>Clear filters</Button>
      ) : null}
      {end === undefined ? null : (
        <div className="ui-toolbar-end ui-filterbar-end">{end}</div>
      )}
    </div>
  );
}
