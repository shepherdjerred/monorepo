import pg from "pg";
import { createFanout, parseNotification } from "./feed.ts";
import type { ChangeFeed } from "./feed.ts";

const CHANNEL = "delivery_changes";
const MAX_BACKOFF_MS = 30_000;

function warn(message: string, error: unknown) {
  console.warn(
    JSON.stringify({
      message,
      errorType: error instanceof Error ? error.name : typeof error,
    }),
  );
}

/**
 * Listen for committed Audit rows. NOTIFY is delivered only on commit and in
 * commit order, so a browser never refetches before a write is visible. After
 * a dropped connection the feed reconnects and tells browsers to resync,
 * because notifications sent while disconnected are lost.
 */
export function createChangeListener(connectionString: string) {
  const fanout = createFanout();
  let client: pg.Client | null = null;
  let stopped = false;
  const isStopped = () => stopped;

  function listen() {
    const next = new pg.Client({ connectionString });
    next.on("notification", (message) => {
      if (message.channel !== CHANNEL || message.payload === undefined) return;
      fanout.publish({
        type: "change",
        change: parseNotification(message.payload),
      });
    });
    next.on("error", (error) => {
      warn("delivery_change_feed_error", error);
      void reconnect(next);
    });
    next.on("end", () => {
      void reconnect(next);
    });
    return next;
  }

  /** Only a listening client owns reconnection; a failed attempt never does. */
  async function connect(next: pg.Client) {
    await next.connect();
    await next.query(`LISTEN ${CHANNEL}`);
    client = next;
  }

  /**
   * Retry with backoff until listening or stopped. A database outage must not
   * stop the server from booting; browsers poll until the feed is live.
   */
  async function establish(attempt: number) {
    for (let current = attempt; !isStopped(); current += 1) {
      if (current > 0)
        await Bun.sleep(Math.min(MAX_BACKOFF_MS, 250 * 2 ** current));
      if (isStopped()) return;
      const next = listen();
      try {
        await connect(next);
        if (current > 0) fanout.publish({ type: "resync" });
        return;
      } catch (error) {
        warn("delivery_change_feed_connect_failed", error);
        await next.end().catch(() => null);
      }
    }
  }

  async function reconnect(previous: pg.Client) {
    if (client !== previous || isStopped()) return;
    client = null;
    await establish(1);
  }

  const feed: ChangeFeed & {
    start: () => Promise<void>;
    stop: () => Promise<void>;
  } = {
    subscribe: (listener) => fanout.subscribe(listener),
    /** Resolves once listening, or when stopped first; it never rejects. */
    start: () => establish(0),
    async stop() {
      stopped = true;
      const current = client;
      client = null;
      await current?.end();
    },
  };
  return feed;
}
