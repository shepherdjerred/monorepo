import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ContentItem } from "#src/model/content";
import type { WatchStatus } from "#src/model/watch-status";
import { createLocalStore } from "#src/lib/local-store";
import { WATCH_STATUS_KEY } from "#src/storage/keys";
import { parseStoredWatchStatuses } from "#src/storage/schemas";
import { useContent } from "./use-content.ts";

const watchStatusStore = createLocalStore({
  key: WATCH_STATUS_KEY,
  parse: parseStoredWatchStatuses,
  empty: [],
});

export type UseWatchStatusResult = {
  /** Watch statuses resolved against current content. */
  watchStatuses: WatchStatus[];
  isWatched: (item: ContentItem) => boolean;
  toggle: (item: ContentItem) => void;
};

export function useWatchStatus(): UseWatchStatusResult {
  const stored = useSyncExternalStore(
    watchStatusStore.subscribe,
    watchStatusStore.getSnapshot,
  );
  const { itemsByUuid } = useContent();

  const watchStatuses = useMemo(
    () =>
      stored.flatMap((entry): WatchStatus[] => {
        const item = itemsByUuid.get(entry.uuid);
        return item === undefined
          ? []
          : [
              {
                item,
                isWatched: entry.watched,
                lastUpdate: new Date(entry.updatedAt),
              },
            ];
      }),
    [stored, itemsByUuid],
  );

  const watchedUuids = useMemo(
    () =>
      new Set(
        stored.filter((entry) => entry.watched).map((entry) => entry.uuid),
      ),
    [stored],
  );

  const isWatched = useCallback(
    (item: ContentItem) => watchedUuids.has(item.uuid),
    [watchedUuids],
  );

  const toggle = useCallback((item: ContentItem) => {
    watchStatusStore.update((current) => {
      const existing = current.find((entry) => entry.uuid === item.uuid);
      const rest = current.filter((entry) => entry.uuid !== item.uuid);
      return [
        {
          uuid: item.uuid,
          kind: item.kind,
          watched: existing === undefined ? true : !existing.watched,
          updatedAt: new Date().toISOString(),
        },
        ...rest,
      ];
    });
  }, []);

  return { watchStatuses, isWatched, toggle };
}
