import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ContentItem } from "#src/model/content";
import type { Bookmark } from "#src/model/bookmark";
import { createLocalStore } from "#src/lib/local-store";
import { BOOKMARKS_KEY } from "#src/storage/keys";
import { parseStoredBookmarks } from "#src/storage/schemas";
import { useContent } from "./use-content.ts";

const bookmarkStore = createLocalStore({
  key: BOOKMARKS_KEY,
  parse: parseStoredBookmarks,
  empty: [],
});

export type UseBookmarksResult = {
  /** Bookmarks resolved against current content, newest first. */
  bookmarks: Bookmark[];
  isBookmarked: (item: ContentItem) => boolean;
  toggle: (item: ContentItem) => void;
};

export function useBookmarks(): UseBookmarksResult {
  const stored = useSyncExternalStore(
    bookmarkStore.subscribe,
    bookmarkStore.getSnapshot,
  );
  const { itemsByUuid } = useContent();

  const bookmarks = useMemo(
    () =>
      stored.flatMap((entry): Bookmark[] => {
        const item = itemsByUuid.get(entry.uuid);
        // Entries whose content no longer exists stay in storage but are
        // hidden until the manifest (or a future manifest refresh) has them.
        return item === undefined
          ? []
          : [{ item, date: new Date(entry.bookmarkedAt) }];
      }),
    [stored, itemsByUuid],
  );

  const bookmarkedUuids = useMemo(
    () => new Set(stored.map((entry) => entry.uuid)),
    [stored],
  );

  const isBookmarked = useCallback(
    (item: ContentItem) => bookmarkedUuids.has(item.uuid),
    [bookmarkedUuids],
  );

  const toggle = useCallback((item: ContentItem) => {
    bookmarkStore.update((current) => {
      if (current.some((entry) => entry.uuid === item.uuid)) {
        return current.filter((entry) => entry.uuid !== item.uuid);
      }
      return [
        {
          uuid: item.uuid,
          kind: item.kind,
          bookmarkedAt: new Date().toISOString(),
        },
        ...current,
      ];
    });
  }, []);

  return { bookmarks, isBookmarked, toggle };
}
