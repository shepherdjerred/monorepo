import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";

/** One page of a cursor-paged read. A null `nextCursor` is the last page. */
export type CursorPage<Item> = {
  items: readonly Item[];
  nextCursor: string | null;
};

/**
 * `more` shows the first page and reads another each time the reader asks.
 * `all` reads every page before showing anything, for a list whose rows are
 * matched against another list and so must be complete.
 */
type Paging = "more" | "all";

/** A read that never reaches a last page is a broken cursor, not a long list. */
const ALL_PAGES_LIMIT = 100;

/** The first page has no cursor; the return type keeps later ones typed. */
function firstCursor(): string | null {
  return null;
}

/** Follows `nextCursor` from the first page to the last. */
export async function readEveryPage<Item>(
  read: (cursor: string | null) => Promise<CursorPage<Item>>,
): Promise<CursorPage<Item>> {
  const items: Item[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < ALL_PAGES_LIMIT; page += 1) {
    const next: CursorPage<Item> = await read(cursor);
    items.push(...next.items);
    if (next.nextCursor === null) return { items, nextCursor: null };
    cursor = next.nextCursor;
  }
  throw new Error(
    `A cursor-paged read did not end within ${String(ALL_PAGES_LIMIT)} pages`,
  );
}

/**
 * A cursor-paged list: its rows so far and how to get more. The one place
 * the client follows `nextCursor`.
 *
 * While a changed `queryKey` (new filters, another sort) is loading, the
 * previous rows stay and `stale` is true, so a page can dim them instead of
 * emptying itself between two answers.
 */
export function useCursorList<Item>(options: {
  queryKey: QueryKey;
  read: (cursor: string | null) => Promise<CursorPage<Item>>;
  paging?: Paging;
  refetchInterval?: number;
}) {
  const { read, paging = "more" } = options;
  const query = useInfiniteQuery({
    queryKey: options.queryKey,
    initialPageParam: firstCursor(),
    queryFn: ({ pageParam }) =>
      paging === "all" ? readEveryPage(read) : read(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (previous) => previous,
    ...(options.refetchInterval === undefined
      ? {}
      : { refetchInterval: options.refetchInterval }),
  });
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    /** Nothing to show yet: the first answer has not arrived. */
    pending: query.isPending,
    /** The rows shown answer an earlier question; the new answer is loading. */
    stale: query.isPlaceholderData,
    error: query.error,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
    retry: () => {
      void query.refetch();
    },
  };
}
