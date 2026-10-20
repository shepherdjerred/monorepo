import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { ChangeEventSchema } from "#shared/hub/change-contract.ts";
import { keysForChange } from "./change-keys.ts";

export type FeedStatus = "connecting" | "live" | "reconnecting";

/**
 * Server-Sent Events of committed Delivery changes. Each change refetches the
 * visible queries it can affect; a reconnect refetches everything, because
 * changes made while disconnected are not replayed.
 */
export function createChangeFeed(queryClient: QueryClient) {
  let status: FeedStatus = "connecting";
  let missed = false;
  const listeners = new Set<() => void>();
  function set(next: FeedStatus) {
    status = next;
    for (const listener of listeners) listener();
  }
  function start() {
    const source = new EventSource("/api/v1/events");
    source.addEventListener("ready", () => {
      if (missed) void queryClient.invalidateQueries();
      missed = false;
      set("live");
    });
    source.addEventListener("change", (event) => {
      const raw: unknown = JSON.parse(String(event.data));
      for (const queryKey of keysForChange(ChangeEventSchema.parse(raw)))
        void queryClient.invalidateQueries({ queryKey });
    });
    source.addEventListener("resync", () => {
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
