import React from "react";
import { getRouteApi } from "@tanstack/react-router";
import type { IFuseOptions } from "fuse.js";
import { SearchBar } from "./search-bar.tsx";
import { ResultList } from "./result-list.tsx";
import { FilterPanel } from "./filter-panel.tsx";
import type { Filters } from "./filters.ts";
import { ContentCard } from "#src/components/content/content-card";
import { ScoutBanner } from "#src/components/layout/scout-banner";
import { TipsDialog } from "#src/components/layout/tips-dialog";
import type { ContentItem } from "#src/model/content";
import { KINDS } from "#src/model/content";
import { ROLES } from "#src/model/role";
import { useContent } from "#src/hooks/use-content";
import { useBookmarks } from "#src/hooks/use-bookmarks";
import { useWatchStatus } from "#src/hooks/use-watch-status";

const routeApi = getRouteApi("/");

const SEARCHABLE_FIELDS = [
  "title",
  "description",
  "alternateTitle",
  "videos.video.title",
  "videos.video.altTitle",
  "video.title",
  "video.description",
  "video.alternateTitle",
];

const FUSE_OPTIONS: IFuseOptions<ContentItem> = {
  keys: SEARCHABLE_FIELDS,
  minMatchCharLength: 2,
  threshold: 0.3,
  useExtendedSearch: true,
  includeMatches: true,
  ignoreLocation: true,
  includeScore: true,
};

const ITEMS_PER_PAGE = 20;

export function SearchPage(): React.ReactElement {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { content, error } = useContent();
  const { isBookmarked, toggle: toggleBookmark } = useBookmarks();
  const { isWatched, toggle: toggleWatchStatus } = useWatchStatus();

  // A failed manifest fetch/parse leaves `content` undefined, which would
  // render as an empty catalog. Surface it to the route error boundary
  // instead of presenting "no content" as a successful, empty result.
  if (error !== null) {
    throw error;
  }

  const items: ContentItem[] = React.useMemo(() => {
    if (content === undefined) {
      return [];
    }
    return [
      ...content.courses,
      ...content.videos,
      ...content.commentaries,
    ].sort(
      (left, right) => right.releaseDate.getTime() - left.releaseDate.getTime(),
    );
  }, [content]);

  // URL semantics: an empty role/kind list means "no filter".
  const filters: Filters = {
    roles: search.role,
    types: search.kind,
    watched: search.watched,
    bookmarked: search.bookmarked,
  };

  const filteredItems = items
    .filter(
      (item) => filters.roles.length === 0 || filters.roles.includes(item.role),
    )
    .filter(
      (item) => filters.types.length === 0 || filters.types.includes(item.kind),
    )
    .filter((item) => {
      switch (filters.watched) {
        case "watched": {
          return isWatched(item);
        }
        case "unwatched": {
          return !isWatched(item);
        }
        case "any": {
          return true;
        }
      }
    })
    .filter((item) => {
      switch (filters.bookmarked) {
        case "bookmarked": {
          return isBookmarked(item);
        }
        case "unbookmarked": {
          return !isBookmarked(item);
        }
        case "any": {
          return true;
        }
      }
    });

  const onFiltersUpdate = (newFilters: Filters) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        role: newFilters.roles.length === ROLES.length ? [] : newFilters.roles,
        kind: newFilters.types.length === KINDS.length ? [] : newFilters.types,
        watched: newFilters.watched,
        bookmarked: newFilters.bookmarked,
        page: 1,
      }),
    });
  };

  // The filter panel renders "no filter" as everything checked.
  const panelFilters: Filters = {
    ...filters,
    roles: filters.roles.length === 0 ? [...ROLES] : filters.roles,
    types: filters.types.length === 0 ? [...KINDS] : filters.types,
  };

  return (
    <>
      <TipsDialog />
      <SearchBar
        value={search.q}
        onValueUpdate={(newValue) => {
          void navigate({
            search: (previous) => ({ ...previous, q: newValue, page: 1 }),
            replace: true,
          });
        }}
        placeholder="Search for courses, videos, or game commentary"
      />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[14rem_1fr]">
        <aside>
          <FilterPanel
            filters={panelFilters}
            onFiltersUpdate={onFiltersUpdate}
          />
        </aside>
        <main className="min-w-0">
          <ScoutBanner />
          <ResultList
            query={search.q}
            items={filteredItems}
            fuseOptions={FUSE_OPTIONS}
            render={(result) => (
              <ContentCard
                key={result.item.uuid}
                item={result.item}
                matchedStrings={result.matchedStrings}
                isWatched={isWatched}
                isBookmarked={isBookmarked}
                onToggleBookmark={toggleBookmark}
                onToggleWatchStatus={toggleWatchStatus}
              />
            )}
            itemsPerPage={ITEMS_PER_PAGE}
            page={search.page}
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
