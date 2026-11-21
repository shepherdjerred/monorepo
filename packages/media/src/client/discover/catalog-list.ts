import { CatalogSearchSchema } from "#shared/api.ts";
import { readApi } from "#client/api.ts";
import { useCursorList } from "#client/ui/use-cursor-list.ts";
import { uniqueEntries, type CatalogEntry } from "./card.ts";
import { catalogReadPath, type CatalogSource } from "./view.ts";

/** Every catalog read is under this key, so one call refreshes them all. */
export const CATALOG_QUERY_KEY = "catalog";

/**
 * A search or a feed, a page at a time. The catalog numbers its pages, so
 * the cursor the list follows is the next page's number.
 *
 * Each title keeps the `libraryAccess` of the page it came on: access is
 * confirmed for a few minutes at a time, so a later page can come back
 * unable to say what an earlier one could.
 */
export function useCatalogList(source: CatalogSource) {
  const list = useCursorList<CatalogEntry>({
    queryKey: [CATALOG_QUERY_KEY, source],
    read: async (cursor) => {
      const answer = await readApi(
        catalogReadPath(source, cursor === null ? 1 : Number(cursor)),
        CatalogSearchSchema,
      );
      return {
        items: answer.results.map((item) => ({
          item,
          access: answer.libraryAccess,
        })),
        nextCursor:
          answer.page < answer.totalPages ? String(answer.page + 1) : null,
      };
    },
  });
  return {
    ...list,
    entries: uniqueEntries(list.items),
    /** Some title here could not be checked against the library. */
    accessStale: list.items.some((entry) => entry.access === "stale"),
  };
}

export type CatalogList = ReturnType<typeof useCatalogList>;
