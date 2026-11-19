import { Search } from "lucide-react";
import { EnumPicker, type EnumOption } from "#client/controls/enum-picker.tsx";

export function withSearchParam(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue = "",
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === defaultValue) {
    next.delete(key);
  } else {
    next.set(key, value);
  }
  return next;
}

export function CollectionToolbar({
  ariaLabel,
  padded = false,
  searchId,
  searchLabel,
  searchPlaceholder,
  query,
  onQueryChange,
  sortId,
  sortLabel,
  sortValue,
  sortOptions,
  onSortChange,
}: {
  ariaLabel: string;
  padded?: boolean;
  searchId: string;
  searchLabel: string;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  sortId: string;
  sortLabel: string;
  sortValue: string;
  sortOptions: readonly EnumOption[];
  onSortChange: (value: string) => void;
}) {
  return (
    <search
      className={
        padded
          ? "collection-toolbar collection-toolbar-padded"
          : "collection-toolbar"
      }
      aria-label={ariaLabel}
    >
      <div className="filter-search">
        <Search size={14} aria-hidden="true" />
        <input
          id={searchId}
          type="search"
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          value={query}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
        />
      </div>
      <span className="spacer" />
      <EnumPicker
        id={sortId}
        label={sortLabel}
        value={sortValue}
        options={sortOptions}
        onChange={onSortChange}
      />
    </search>
  );
}
