import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  ChangeFeed,
  FeedMessage,
} from "#infrastructure/change-feed/feed.ts";
import type { Principal } from "#shared/contract.ts";

/** Below Bun's default 10 s idle timeout so idle streams stay open. */
const HEARTBEAT_MS = 8000;

/**
 * Server-Sent Events of committed changes. Each event names the changed
 * entity; browsers refetch what they show. No replay: a reconnecting browser
 * refetches everything it shows.
 */
export function registerEventsRoute(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  feed: ChangeFeed | undefined,
) {
  app.get("/api/v1/events", (c) =>
    streamSSE(c, async (stream) => {
      const queue: FeedMessage[] = [];
      const isAborted = () => stream.aborted;
      let wake: (() => void) | undefined;
      const unsubscribe =
        feed?.subscribe((message) => {
          queue.push(message);
          wake?.();
        }) ??
        (() => {
          // A feed-less app (tests without PostgreSQL LISTEN) only heartbeats.
        });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: "ready", data: "{}", retry: 3000 });
      while (!stream.aborted) {
        const message = queue.shift();
        if (message === undefined) {
          await Promise.race([
            new Promise<void>((resolve) => {
              wake = resolve;
            }),
            stream.sleep(HEARTBEAT_MS),
          ]);
          wake = undefined;
          if (queue.length === 0 && !isAborted())
            await stream.write(": heartbeat\n\n");
        } else if (message.type === "resync") {
          await stream.writeSSE({ event: "resync", data: "{}" });
        } else {
          await stream.writeSSE({
            event: "change",
            id: message.change.id,
            data: JSON.stringify(message.change),
          });
        }
      }
    }),
  );
}
