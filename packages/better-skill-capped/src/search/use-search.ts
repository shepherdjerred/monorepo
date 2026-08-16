import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Content } from "#src/model/content";
import { useContent } from "#src/hooks/use-content";
import { useBookmarks } from "#src/hooks/use-bookmarks";
import { useWatchStatus } from "#src/hooks/use-watch-status";
import { contentToSearchDocs } from "./search-doc.ts";
import { createSearchIndex } from "./index-builder.ts";
import type { SearchIndex } from "./index-builder.ts";
import { runSearch } from "./run-search.ts";
import type { SearchRunParams, SearchRunResult } from "./run-search.ts";

// Index memoized on the manifest stamp: rebuilt only when a new manifest
// payload lands, never on filter/bookmark/watch changes. Keyed by the same
// `dataUpdatedAt` value that keys the search query, so the queryFn never
// closes over reactive state that isn't in its queryKey.
const indexByStamp = new Map<number, Promise<SearchIndex>>();

function getSearchIndex(stamp: number, content: Content): Promise<SearchIndex> {
  let cached = indexByStamp.get(stamp);
  if (cached === undefined) {
    cached = createSearchIndex(contentToSearchDocs(content));
    indexByStamp.clear();
    indexByStamp.set(stamp, cached);
  }
  return cached;
}

export type UseSearchResult = {
  result: SearchRunResult | undefined;
  isPending: boolean;
};

/**
 * Search-as-a-query: the in-memory Orama pass runs in a TanStack Query keyed
 * on every input, so results are cached, deduplicated across renders, and
 * `keepPreviousData` prevents flicker while typing. No effects involved.
 */
export function useSearch(params: SearchRunParams): UseSearchResult {
  const { content, dataUpdatedAt } = useContent();
  const { watchedUuids } = useWatchStatus();
  const { bookmarkedUuids } = useBookmarks();

  // Warm the stamp-keyed cache during render so the queryFn only needs the
  // stamp (which is part of the queryKey). The promise is consumed inside
  // the queryFn; rejections surface through the query state there.
  if (content !== undefined) {
    void getSearchIndex(dataUpdatedAt, content);
  }

  const query = useQuery({
    queryKey: [
      "search",
      dataUpdatedAt,
      params,
      [...watchedUuids].sort().join(","),
      [...bookmarkedUuids].sort().join(","),
    ],
    enabled: content !== undefined,
    placeholderData: keepPreviousData,
    // The search runs entirely in memory; never persist or refetch it.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60 * 1000,
    queryFn: async () => {
      const index = indexByStamp.get(dataUpdatedAt);
      if (index === undefined) {
        throw new Error("Search ran before the index was built");
      }
      return runSearch(await index, params, { watchedUuids, bookmarkedUuids });
    },
  });

  return { result: query.data, isPending: query.isPending };
}
