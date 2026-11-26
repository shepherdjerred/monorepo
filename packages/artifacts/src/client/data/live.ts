import { useEffect } from "react";
import { LiveMessageSchema } from "@shepherdjerred/artifacts/contract";
import { queryClient } from "./api.ts";

/** A tab hidden this long lets its stream go until it is shown again. */
const HIDDEN_PAUSE_MS = 60_000;
/** Bursts of changes (a publish touches several rows) refetch once. */
const COALESCE_MS = 150;

const EVENT_NAMES = [
  "ready",
  "feedback",
  "board",
  "change",
  "resync",
  "gone",
] as const;

/**
 * Keeps the open page current: one `EventSource` on `/api/events/stream`
 * (scoped to a board when there is one), invalidating every query when
 * something changed. The stream only wakes a client, so a message carries no
 * data worth reading; the contract schema still rejects a broken frame.
 * Own changes are refetched too, which is harmless: they are idempotent reads.
 */
export function useLiveUpdates(board?: string): void {
  useEffect(() => {
    const url =
      board === undefined
        ? "/api/events/stream"
        : `/api/events/stream?board=${encodeURIComponent(board)}`;
    let source: EventSource | undefined;
    let pause: ReturnType<typeof setTimeout> | undefined;
    let flush: ReturnType<typeof setTimeout> | undefined;

    function refetch(): void {
      clearTimeout(flush);
      flush = setTimeout(() => {
        void queryClient.invalidateQueries();
      }, COALESCE_MS);
    }

    function receive(event: MessageEvent<unknown>): void {
      if (typeof event.data !== "string") return;
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const message = LiveMessageSchema.safeParse(payload);
      if (!message.success) {
        console.error("Live update broke the contract", message.error.message);
        return;
      }
      if (message.data.type === "ready") return;
      refetch();
    }

    function open(): void {
      source?.close();
      const stream = new EventSource(url);
      source = stream;
      for (const name of EVENT_NAMES) stream.addEventListener(name, receive);
      stream.addEventListener("message", receive);
      stream.addEventListener("open", () => {
        // A reconnect may have missed changes.
        refetch();
      });
      stream.addEventListener("error", () => {
        if (stream.readyState === EventSource.CLOSED) {
          source = undefined;
        }
      });
    }

    function onVisibility(): void {
      clearTimeout(pause);
      if (document.visibilityState === "hidden") {
        pause = setTimeout(() => {
          source?.close();
          source = undefined;
        }, HIDDEN_PAUSE_MS);
      } else if (source === undefined) {
        open();
      }
    }

    open();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(pause);
      clearTimeout(flush);
      source?.close();
    };
  }, [board]);
}
