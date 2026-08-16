import React, { useDeferredValue, useMemo } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { SearchBar } from "./search-bar.tsx";
import { FilterPanel } from "./filter-panel.tsx";
import { PaginationControls } from "./pagination-controls.tsx";
import { ActiveFilters } from "./active-filters.tsx";
import { ContentCard } from "#src/components/content/content-card";
import { ScoutBanner } from "#src/components/layout/scout-banner";
import { RecommendedRail } from "#src/features/home/recommended-rail";
import { useContent } from "#src/hooks/use-content";
import { useBookmarks } from "#src/hooks/use-bookmarks";
import { useWatchStatus } from "#src/hooks/use-watch-status";
import { useSearch } from "#src/search/use-search";
import { getHighlightTerms } from "#src/search/highlight";
import { buildChampionAliases } from "#src/search/normalize";
import type { SearchParams } from "#src/routes/search";
import { isUnfilteredFirstPage } from "#src/routes/search";
import type { SortOption } from "#src/search/run-search";

const routeApi = getRouteApi("/");

const SORT_OPTIONS: SortOption[] = [
  "relevance",
  "newest",
  "oldest",
  "shortest",
  "longest",
];

const SORT_LABELS: Record<SortOption, string> = {
  relevance: "Relevance",
  newest: "Newest",
  oldest: "Oldest",
  shortest: "Shortest",
  longest: "Longest",
};

export function SearchPage(): React.ReactElement {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { content, itemsByUuid, error } = useContent();
  const { isBookmarked, toggle: toggleBookmark } = useBookmarks();
  const { isWatched, toggle: toggleWatchStatus } = useWatchStatus();

  // A failed manifest fetch/parse leaves `content` undefined, which would
  // render as an empty catalog. Surface it to the route error boundary
  // instead of presenting "no content" as a successful, empty result.
  if (error !== null) {
    throw error;
  }

  // Defer the query so typing stays responsive; the search itself is an
  // in-memory pass over ~6.3k docs.
  const deferredQ = useDeferredValue(search.q);
  const { result } = useSearch({ ...search, q: deferredQ });

  const championAliases = useMemo(
    () =>
      buildChampionAliases(
        (content?.commentaries ?? []).flatMap((commentary) => [
          commentary.champion,
          commentary.opponent,
        ]),
      ),
    [content],
  );
  const highlightTerms = useMemo(
    () => getHighlightTerms(deferredQ, championAliases),
    [deferredQ, championAliases],
  );

  // `runSearch` clamps an out-of-range `page` (a stale link, a hand-edited URL,
  // or a filter change that shrank the result set) so the user still sees
  // results. Write the clamped page back so the URL keeps being the source of
  // truth — otherwise ?page=99 stays shareable while page 3 is on screen.
  // `replace` keeps the bogus page out of history, and the mismatch guard makes
  // the effect a no-op on the next render rather than a navigation loop.
  const clampedPage = result?.page;
  React.useEffect(() => {
    if (clampedPage !== undefined && clampedPage !== search.page) {
      void navigate({
        search: (previous) => ({ ...previous, page: clampedPage }),
        replace: true,
      });
    }
  }, [clampedPage, search.page, navigate]);

  const updateSearch = (updated: Partial<SearchParams>) => {
    void navigate({
      search: (previous) => ({ ...previous, ...updated, page: 1 }),
    });
  };

  const items = (result?.docs ?? []).flatMap((doc) => {
    const item = itemsByUuid.get(doc.uuid);
    return item === undefined ? [] : [item];
  });

  return (
    <>
      <SearchBar
        value={search.q}
        onValueUpdate={(newValue) => {
          void navigate({
            search: (previous) => ({ ...previous, q: newValue, page: 1 }),
            replace: true,
          });
        }}
        placeholder="Search for courses, videos, or game commentary — typos are okay"
      />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[14rem_1fr]">
        <aside>
          <FilterPanel
            params={search}
            facets={result?.facets}
            onChange={updateSearch}
          />
        </aside>
        <main className="min-w-0">
          <ScoutBanner />
          <RecommendedRail visible={isUnfilteredFirstPage(search)} />
          <ActiveFilters params={search} onChange={updateSearch} />
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {result === undefined
                ? "Loading…"
                : `${String(result.total)} results`}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Sort</span>
              <select
                className="h-8 rounded-lg border bg-background px-2 text-sm"
                value={search.sort}
                onChange={(event) => {
                  const selected = SORT_OPTIONS.find(
                    (option) => option === event.target.value,
                  );
                  updateSearch({ sort: selected ?? "relevance" });
                }}
              >
                {SORT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {SORT_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {items.length === 0 && result !== undefined && (
            <p className="py-12 text-center text-muted-foreground">
              No results. Try a different query or loosen the filters.
            </p>
          )}
          {items.map((item) => (
            <ContentCard
              key={item.uuid}
              item={item}
              matchedStrings={highlightTerms}
              isWatched={isWatched}
              isBookmarked={isBookmarked}
              onToggleBookmark={toggleBookmark}
              onToggleWatchStatus={toggleWatchStatus}
            />
          ))}
          <PaginationControls
            currentPage={result?.page ?? search.page}
            lastPage={result?.pageCount ?? 0}
            onPageChange={(newPage) => {
              // Scrolling here (the event handler) rather than in an effect —
              // scrollRestoration only manages full-navigation scroll.
              window.scrollTo(0, 0);
              void navigate({
                search: (previous) => ({ ...previous, page: newPage }),
              });
            }}
          />
        </main>
      </div>
    </>
  );
}
