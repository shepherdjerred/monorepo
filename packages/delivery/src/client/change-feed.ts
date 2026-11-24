import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { ChangeEventSchema } from "#shared/hub/change-contract.ts";
import { keysForChange } from "./change-keys.ts";

export type FeedStatus = "connecting" | "live" | "reconnecting";

const CHANGE_COALESCE_MS = 150;

type EventSourceLike = Pick<EventTarget, "addEventListener">;

/**
 * Server-Sent Events of committed Delivery changes. Rapid bursts (such as CI
 * registering dozens of pending builds) coalesce into one deduplicated batch of
 * query invalidations; a reconnect refetches everything, because changes made
 * while disconnected are not replayed.
 */
export function createChangeFeed(
  queryClient: QueryClient,
  options?: {
    coalesceMs?: number;
    openEventSource?: (url: string) => EventSourceLike;
  },
) {
  const coalesceMs = options?.coalesceMs ?? CHANGE_COALESCE_MS;
  const openSource =
    options?.openEventSource ?? ((url: string) => new EventSource(url));
  let status: FeedStatus = "connecting";
  let missed = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingKeys = new Map<string, readonly unknown[]>();
  const listeners = new Set<() => void>();
  function set(next: FeedStatus) {
    status = next;
    for (const listener of listeners) listener();
  }
  function clearPending() {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    pendingKeys.clear();
  }
  function flushPending() {
    flushTimer = undefined;
    const keys = [...pendingKeys.values()];
    pendingKeys.clear();
    for (const queryKey of keys)
      void queryClient.invalidateQueries({ queryKey });
  }
  function scheduleInvalidations(keys: readonly (readonly unknown[])[]) {
    for (const queryKey of keys)
      pendingKeys.set(JSON.stringify(queryKey), queryKey);
    flushTimer ??= setTimeout(flushPending, coalesceMs);
  }
  function start() {
    const source = openSource("/api/v1/events");
    source.addEventListener("ready", () => {
      if (missed) {
        clearPending();
        void queryClient.invalidateQueries();
      }
      missed = false;
      set("live");
    });
    source.addEventListener("change", (event) => {
      if (!("data" in event)) return;
      const raw: unknown = JSON.parse(String(event.data));
      scheduleInvalidations(keysForChange(ChangeEventSchema.parse(raw)));
    });
    source.addEventListener("resync", () => {
      clearPending();
      void queryClient.invalidateQueries();
    });
    source.addEventListener("error", () => {
      missed = true;
      set("reconnecting");
    });
  }
  return {
    start,
    getSnapshot: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type ChangeFeed = ReturnType<typeof createChangeFeed>;

export function useFeedStatus(feed: ChangeFeed) {
  return useSyncExternalStore(
    (listener) => feed.subscribe(listener),
    () => feed.getSnapshot(),
  );
}
