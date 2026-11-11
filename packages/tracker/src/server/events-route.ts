import type { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
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

/** Resolves `idle` on the next `wake` or after one heartbeat; leaves no timer. */
function createWaiter(heartbeatMs: number) {
  let wakeUp: (() => void) | undefined;
  return {
    wake: () => wakeUp?.(),
    idle: () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wakeUp?.();
        }, heartbeatMs);
        wakeUp = () => {
          clearTimeout(timer);
          wakeUp = undefined;
          resolve();
        };
      }),
  };
}

function writeMessage(
  stream: SSEStreamingApi,
  message: LiveMessage,
  first: boolean,
) {
  return stream.writeSSE({
    event: message.type,
    data: JSON.stringify(message),
    ...(message.type === "change" ? { id: message.eventId } : {}),
    ...(first ? { retry: 3000 } : {}),
  });
}

/** Rate-limits flag reads to one per heartbeat, independent of traffic. */
function createFlagGate(enabled: () => Promise<boolean>, intervalMs: number) {
  let checkedAt = Date.now();
  return {
    due: () => Date.now() - checkedAt >= intervalMs,
    check: () => {
      checkedAt = Date.now();
      return enabled();
    },
  };
}

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
      const waiter = createWaiter(heartbeatMs);
      const close = () => {
        open = false;
        waiter.wake();
      };
      const unsubscribe = options.changes.subscribe({
        message(message) {
          if (queue.length >= MAX_QUEUED) queue.splice(0, queue.length, RESYNC);
          else queue.push(message);
          waiter.wake();
        },
        closed: close,
      });
      stream.onAbort(() => {
        unsubscribe();
        close();
      });
      try {
        let first = true;
        const flag = createFlagGate(options.liveUpdatesEnabled, heartbeatMs);
        while (isOpen()) {
          // Turning the flag off ends open streams within one heartbeat, even
          // while changes keep arriving.
          if (flag.due() && !(await flag.check())) break;
          const message = queue.shift();
          if (message === undefined) {
            await waiter.idle();
            if (queue.length > 0 || !isOpen()) continue;
            if (!(await flag.check())) break;
            await stream.write(": heartbeat\n\n");
            continue;
          }
          await writeMessage(stream, message, first);
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
