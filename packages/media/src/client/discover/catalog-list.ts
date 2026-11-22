import { CatalogSearchSchema, type CatalogSearch } from "#shared/api.ts";
import type { LibraryAccess } from "#shared/catalog/contract.ts";
import { readApi } from "#client/api.ts";
import { useCursorList, type CursorPage } from "#client/ui/use-cursor-list.ts";
import { uniqueEntries, type CatalogEntry } from "./card.ts";
import { catalogReadPath, type CatalogSource } from "./view.ts";

/** Every catalog read is under this key, so one call refreshes them all. */
export const CATALOG_QUERY_KEY = "catalog";

/**
 * One answer of the catalog as a page of the list. `access` is the page's
 * own: it holds whether or not the page has a title to carry it.
 */
type CatalogPage = CursorPage<CatalogEntry> & { access: LibraryAccess };

/**
 * The catalog numbers its pages, so the cursor the list follows is the next
 * page's number. Each title also keeps the `libraryAccess` of the page it
 * came on, which is what its card is drawn from.
 */
export function catalogPage(answer: CatalogSearch): CatalogPage {
  return {
    items: answer.results.map((item) => ({
      item,
      access: answer.libraryAccess,
    })),
    nextCursor:
      answer.page < answer.totalPages ? String(answer.page + 1) : null,
    access: answer.libraryAccess,
  };
}

/**
 * Whether any page read so far could not be checked against the library.
 * Access is confirmed for a few minutes at a time, so a later page can come
 * back unable to say what an earlier one could; and a page that found no
 * titles could still not be checked.
 */
export function accessIsStale(
  pages: readonly Pick<CatalogPage, "access">[],
): boolean {
  return pages.some((page) => page.access === "stale");
}

/** A search or a feed, a page at a time. */
export function useCatalogList(source: CatalogSource) {
  const list = useCursorList({
    queryKey: [CATALOG_QUERY_KEY, source],
    read: async (cursor) =>
      catalogPage(
        await readApi(
          catalogReadPath(source, cursor === null ? 1 : Number(cursor)),
          CatalogSearchSchema,
        ),
      ),
  });
  return {
    ...list,
    entries: uniqueEntries(list.items),
    /** Media could not confirm the reader's library access for this list. */
    accessStale: accessIsStale(list.pages),
  };
}

export type CatalogList = ReturnType<typeof useCatalogList>;
