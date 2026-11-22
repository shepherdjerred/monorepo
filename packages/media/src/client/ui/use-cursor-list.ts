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
 * How many pages in a row one look reads when each comes back empty. An API
 * that decides what a reader may see after it has cut the page can answer
 * with nothing and still have more behind it; this many empty answers is
 * where a look stops and the list says so, so that a long run of them costs
 * a bounded number of requests and the reader decides whether to go on.
 */
export const EMPTY_PAGES_PER_LOOK = 5;

/**
 * One look at a list from `cursor`: the first page with anything in it, or
 * the last page of the list, or, after `EMPTY_PAGES_PER_LOOK` empty pages
 * with more still behind them, the last of those. Each page must move the
 * cursor on; one that hands back the cursor it was read with would be read
 * for ever, so it is an error.
 */
export async function readPastEmptyPages<Item>(
  read: (cursor: string | null) => Promise<CursorPage<Item>>,
  cursor: string | null,
): Promise<CursorPage<Item>> {
  let from = cursor;
  let page = await read(from);
  for (let looked = 1; looked < EMPTY_PAGES_PER_LOOK; looked += 1) {
    if (page.items.length > 0 || page.nextCursor === null) return page;
    if (page.nextCursor === from) {
      throw new Error("A cursor-paged read answered with its own cursor");
    }
    from = page.nextCursor;
    page = await read(from);
  }
  return page;
}

/**
 * A cursor-paged list: its rows so far and how to get more. The one place
 * the client follows `nextCursor`.
 *
 * While a changed `queryKey` (new filters, another sort) is loading, the
 * previous rows stay and `stale` is true, so a page can dim them instead of
 * emptying itself between two answers.
 *
 * `emptyPages: "skip"` is for a read whose pages can be empty with more
 * behind them: each look (the first, and each `loadMore`) reads on past them
 * (`readPastEmptyPages`). A list can then still be empty with `hasMore` set,
 * which means a whole look found nothing; the page says so and offers
 * another look.
 */
export function useCursorList<Item>(options: {
  queryKey: QueryKey;
  read: (cursor: string | null) => Promise<CursorPage<Item>>;
  paging?: Paging;
  emptyPages?: "show" | "skip";
  refetchInterval?: number;
}) {
  const { read, paging = "more", emptyPages = "show" } = options;
  const look = (cursor: string | null) =>
    emptyPages === "skip" ? readPastEmptyPages(read, cursor) : read(cursor);
  const query = useInfiniteQuery({
    queryKey: options.queryKey,
    initialPageParam: firstCursor(),
    queryFn: ({ pageParam }) =>
      paging === "all" ? readEveryPage(read) : look(pageParam),
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
