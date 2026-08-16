import React, { useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import type { IFuseOptions } from "fuse.js";
import { Searchbar } from "./search/searchbar.tsx";
import PaginatedFuseSearch from "./search/paginated-fuse-search.tsx";
import { Container } from "#src/components/container";
import FilterSelector from "./filter/filter-selector.tsx";
import type { Filters } from "./filter/filters.ts";
import type { OmniSearchable } from "./omni-searchable.ts";
import { searchableFields } from "./omni-searchable.ts";
import { OmniSearchResult } from "./omni-search-result.tsx";
import { TipsButton } from "#src/components/tips-button";
import { TipsModal } from "#src/components/modal/tips-modal";
import Banner, { BannerType } from "#src/components/banner";
import { KINDS } from "#src/model/content";
import { ROLES } from "#src/model/role";
import { useContent } from "#src/hooks/use-content";
import { useBookmarks } from "#src/hooks/use-bookmarks";
import { useWatchStatus } from "#src/hooks/use-watch-status";
import { useDownloadEnabled } from "#src/hooks/use-download-enabled";

const routeApi = getRouteApi("/");

const FUSE_OPTIONS: IFuseOptions<OmniSearchable> = {
  keys: searchableFields,
  minMatchCharLength: 2,
  threshold: 0.3,
  useExtendedSearch: true,
  includeMatches: true,
  ignoreLocation: true,
  includeScore: true,
};

const ITEMS_PER_PAGE = 20;

export function OmniSearch(): React.ReactElement {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { content, error } = useContent();

  // A failed manifest fetch/parse leaves `content` undefined, which would
  // render as an empty catalog. Surface it to the route error boundary
  // instead of presenting "no content" as a successful, empty result.
  if (error !== null) {
    throw error;
  }
  const { isBookmarked, toggle: toggleBookmark } = useBookmarks();
  const { isWatched, toggle: toggleWatchStatus } = useWatchStatus();
  const isDownloadEnabled = useDownloadEnabled();
  const [isTipsModalVisible, setTipsModalVisible] = useState(false);

  const items: OmniSearchable[] = React.useMemo(() => {
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

  // The selectors render "no filter" as everything checked.
  const selectorFilters: Filters = {
    ...filters,
    roles: filters.roles.length === 0 ? [...ROLES] : filters.roles,
    types: filters.types.length === 0 ? [...KINDS] : filters.types,
  };

  return (
    <>
      <TipsModal
        isVisible={isTipsModalVisible}
        onClose={() => {
          setTipsModalVisible(false);
        }}
      />
      <TipsButton
        onClick={() => {
          setTipsModalVisible(true);
        }}
      />
      <Searchbar
        value={search.q}
        onValueUpdate={(newValue) => {
          void navigate({
            search: (previous) => ({ ...previous, q: newValue, page: 1 }),
            replace: true,
          });
        }}
        placeholder="Search for courses, videos, or game commentary"
      />
      <Container
        sidebar={
          <FilterSelector
            filters={selectorFilters}
            onFiltersUpdate={onFiltersUpdate}
          />
        }
      >
        <Banner type={BannerType.Warning}>
          Check out <a href="https://scout-for-lol.com/">Scout</a> - a Discord
          bot that notifies you when friends finish League matches with detailed
          post-match reports!
        </Banner>
        <PaginatedFuseSearch
          query={search.q}
          items={filteredItems}
          fuseOptions={FUSE_OPTIONS}
          render={(result) => (
            <OmniSearchResult
              key={result.item.uuid}
              item={result.item}
              isWatched={isWatched}
              isBookmarked={isBookmarked}
              onToggleBookmark={toggleBookmark}
              onToggleWatchStatus={toggleWatchStatus}
              matchedStrings={result.matchedStrings}
              isDownloadEnabled={isDownloadEnabled}
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
      </Container>
    </>
  );
}
