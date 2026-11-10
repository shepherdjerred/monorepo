import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChangeHub } from "#infrastructure/change-hub.ts";
import type { LiveMessage } from "#shared/live-updates.ts";

/**
 * Below Bun's default 10 s idle timeout, which `Bun.serve` in `index.ts` does
 * not override, so idle streams stay open.
 */
const HEARTBEAT_MS = 8000;
/** A browser this far behind refetches instead of replaying the backlog. */
const MAX_QUEUED = 1000;
const RESYNC: LiveMessage = { type: "resync" };

export type EventsRouteOptions = {
  changes: ChangeHub;
  liveUpdatesEnabled: () => Promise<boolean>;
  heartbeatMs?: number;
};

/**
 * Server-Sent Events of committed changes. Each message names the changed
 * entity; browsers refetch what they show. There is no replay: every
 * connection starts with `resync`, so a reconnecting browser refetches.
 */
export function registerEventsRoute(app: Hono, options: EventsRouteOptions) {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  let delivered = 0;
  app.get("/api/events/stream", async (c) => {
    if (!(await options.liveUpdatesEnabled()))
      return c.json({ error: "Not found" }, 404);
    // Opens LISTEN on first use when the flag was off at boot.
    void options.changes.start();
    return streamSSE(c, async (stream) => {
      const queue: LiveMessage[] = [RESYNC];
      let open = true;
      const isOpen = () => open && !stream.aborted;
      let wake: (() => void) | undefined;
      const close = () => {
        open = false;
        wake?.();
      };
      const unsubscribe = options.changes.subscribe({
        message(message) {
          if (queue.length >= MAX_QUEUED) queue.splice(0, queue.length, RESYNC);
          else queue.push(message);
          wake?.();
        },
        closed: close,
      });
      stream.onAbort(() => {
        unsubscribe();
        close();
      });
      /** Resolves on the next message, close or heartbeat; leaves no timer. */
      const idle = () =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            wake?.();
          }, heartbeatMs);
          wake = () => {
            clearTimeout(timer);
            wake = undefined;
            resolve();
          };
        });
      try {
        let first = true;
        while (isOpen()) {
          const message = queue.shift();
          if (message === undefined) {
            await idle();
            if (queue.length > 0 || !isOpen()) continue;
            // Turning the flag off ends open streams within one heartbeat.
            if (!(await options.liveUpdatesEnabled())) break;
            await stream.write(": heartbeat\n\n");
            continue;
          }
          await stream.writeSSE({
            event: message.type,
            data: JSON.stringify(message),
            ...(message.type === "change" ? { id: message.eventId } : {}),
            ...(first ? { retry: 3000 } : {}),
          });
          first = false;
          if (message.type === "change") delivered += 1;
        }
      } finally {
        unsubscribe();
      }
    });
  });
  return {
    clients: () => options.changes.subscriberCount(),
    delivered: () => delivered,
  };
}
