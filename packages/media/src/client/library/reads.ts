import { RemovalListSchema, RequestListSchema } from "#shared/api.ts";
import { LibraryPageSchema } from "#shared/household/library.ts";
import { readApi } from "#client/api.ts";
import { readInterests } from "#client/household/interests.tsx";
import { libraryReadPath, type LibraryView } from "./view.ts";

/*
 * The Library's reads, each with the cache key it is kept under. Home shows
 * parts of the same lists, so it reads them through these definitions: one
 * answer then serves both pages, and a change made on either refreshes the
 * other.
 */

/** Everything the reader asked for (the owner: everyone's requests). */
export const REQUESTS_READ = {
  queryKey: ["requests"],
  queryFn: () => readApi("/requests", RequestListSchema),
} as const;

/**
 * Removals that are pending or can still be undone. Leaving soon lists the
 * pending ones, Removed the ones already out of the library, and the page
 * header counts the first, so all three share this one read.
 */
export const REMOVALS_READ = {
  queryKey: ["removals"],
  queryFn: () => readApi("/removals", RemovalListSchema),
  refetchInterval: 15_000,
} as const;

/** Every interest of one person, read to the end: rows are joined by id. */
export function interestsRead(userId: string) {
  return {
    queryKey: ["request-interests", userId],
    read: readInterests,
    paging: "all",
  } as const;
}

/** One view of the library's titles, a page at a time. */
export function libraryRead(view: LibraryView) {
  // How the titles are laid out does not change which titles are asked for,
  // so the layout is no part of the key.
  const question: Omit<LibraryView, "layout"> = {
    query: view.query,
    kind: view.kind,
    keeping: view.keeping,
    status: view.status,
    sort: view.sort,
  };
  return {
    queryKey: ["library", question],
    read: (cursor: string | null) =>
      readApi(libraryReadPath(view, cursor), LibraryPageSchema),
  } as const;
}
