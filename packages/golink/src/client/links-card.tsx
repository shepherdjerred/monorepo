import type { RefObject } from "react";
import {
  Button,
  Card,
  CardToolbar,
  SearchField,
  Segmented,
} from "@shepherdjerred/console-ui";
import type { LinkItem } from "#shared/contract.ts";
import {
  KIND_FILTER_OPTIONS,
  type KindCounts,
  type KindFilter,
} from "./directory-sections.tsx";
import { LinksTable } from "./links-table.tsx";

/** The headline figures above the links card; dashes until the first load. */
export function summaryItems(
  counts: KindCounts,
  links: readonly LinkItem[],
  loaded: boolean,
) {
  const figure = (value: number): string => (loaded ? String(value) : "—");
  const clicks = links.reduce((total, item) => total + (item.clicks ?? 0), 0);
  return [
    { label: "Links", value: figure(counts.all) },
    { label: "Manual", value: figure(counts.manual) },
    { label: "Tailnet", value: figure(counts.ingress) },
    { label: "Public sites", value: figure(counts.site) },
    { label: "Clicks", value: figure(clicks) },
  ];
}

type DirectoryBodyProps = {
  loadError: string | null;
  isInitialLoading: boolean;
  items: readonly LinkItem[];
  totalCount: number;
  writesEnabled: boolean;
  copiedShort: string | null;
  deletingShort: string | null;
  onRetry: () => void;
  onCopy: (short: string) => void;
  onEdit: (item: LinkItem) => void;
  onOverride: (item: LinkItem) => void;
  onDelete: (item: LinkItem) => void;
};

function DirectoryBody({
  loadError,
  isInitialLoading,
  items,
  totalCount,
  writesEnabled,
  copiedShort,
  deletingShort,
  onRetry,
  onCopy,
  onEdit,
  onOverride,
  onDelete,
}: DirectoryBodyProps) {
  if (loadError !== null) {
    return (
      <div className="ui-state golink-load-error" role="alert">
        <p>{loadError}</p>
        <Button size="page" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (isInitialLoading) {
    return (
      <p className="ui-state" role="status" aria-live="polite">
        Loading shortlink directory…
      </p>
    );
  }
  return (
    <LinksTable
      items={items}
      totalCount={totalCount}
      writesEnabled={writesEnabled}
      copiedShort={copiedShort}
      deletingShort={deletingShort}
      onCopy={onCopy}
      onEdit={onEdit}
      onOverride={onOverride}
      onDelete={onDelete}
    />
  );
}

/** The links card: search and source filter over the table. */
export function LinksCard({
  searchInputRef,
  query,
  kindFilter,
  counts,
  onQueryChange,
  onKindFilterChange,
  ...body
}: DirectoryBodyProps & {
  searchInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  kindFilter: KindFilter;
  counts: KindCounts;
  onQueryChange: (next: string) => void;
  onKindFilterChange: (next: KindFilter) => void;
}) {
  return (
    <Card label="Links" id="links">
      <CardToolbar>
        <SearchField
          ref={searchInputRef}
          label="Search links"
          name="q"
          value={query}
          placeholder="Search name, destination or source…  /"
          aria-keyshortcuts="/"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
        />
        <Segmented
          label="Source"
          value={kindFilter}
          options={KIND_FILTER_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            count: counts[option.value],
          }))}
          onChange={onKindFilterChange}
        />
      </CardToolbar>
      <DirectoryBody {...body} />
    </Card>
  );
}
