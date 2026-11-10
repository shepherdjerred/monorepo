import pg from "pg";
import type {
  ChangeStream,
  ChangeSubscriber,
} from "#application/change-stream.ts";
import { LiveChangeSchema, type LiveMessage } from "#shared/live-updates.ts";
import { reportError } from "./observability.ts";

export const CHANGE_CHANNEL = "tracker_events";
export const CHANGE_HUB_APPLICATION = "tracker-live-updates";
const MAX_BACKOFF_MS = 30_000;

/** Parse one `tracker_events` NOTIFY payload written by the Event trigger. */
export function parseChange(payload: string): LiveMessage {
  const raw: unknown = JSON.parse(payload);
  return { type: "change", ...LiveChangeSchema.parse(raw) };
}

const backoff = (failures: number) =>
  Math.min(MAX_BACKOFF_MS, 250 * 2 ** failures);

function describe(message: string, error: unknown) {
  return JSON.stringify({
    message,
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

/**
 * Listen for committed Event rows on one dedicated connection and fan them
 * out in process. NOTIFY is delivered only on commit and in commit order, so
 * a browser never refetches before a write is visible. After a dropped
 * connection the hub reconnects and tells subscribers to resync, because
 * notifications sent while disconnected are lost.
 */
export function createChangeHub(
  connectionString: string,
  options: { report?: (error: unknown) => void } = {},
) {
  const report = options.report ?? reportError;
  const subscribers = new Set<ChangeSubscriber>();
  let client: pg.Client | null = null;
  let started: Promise<void> | undefined;
  let stopped = false;
  const isStopped = () => stopped;

  function publish(message: LiveMessage) {
    for (const subscriber of subscribers) subscriber.message(message);
  }

  function listen() {
    const next = new pg.Client({
      connectionString,
      application_name: CHANGE_HUB_APPLICATION,
      keepAlive: true,
    });
    next.on("notification", (notification) => {
      if (notification.channel !== CHANGE_CHANNEL) return;
      let message: LiveMessage;
      try {
        message = parseChange(notification.payload ?? "");
      } catch (error) {
        // The trigger and this schema are one contract; a mismatch is a bug.
        // The change itself still committed, so subscribers refetch.
        console.error(describe("tracker_live_updates_payload_invalid", error));
        report(error);
        publish({ type: "resync" });
        return;
      }
      publish(message);
    });
    next.on("error", (error) => {
      console.warn(describe("tracker_live_updates_connection_error", error));
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
    await next.query(`LISTEN ${CHANGE_CHANNEL}`);
    if (isStopped()) {
      await next.end();
      return;
    }
    client = next;
  }

  /** One connect attempt; false means it failed and was cleaned up. */
  async function attemptListen() {
    const next = listen();
    try {
      await connect(next);
      return true;
    } catch (error) {
      console.warn(describe("tracker_live_updates_connect_failed", error));
      await next.end().catch(() => null);
      return false;
    }
  }

  /**
   * Retry with backoff until listening or stopped. A database outage must not
   * stop the server from booting; browsers keep working without live updates.
   */
  async function establish(failures: number) {
    let delayMs = failures === 0 ? 0 : backoff(failures);
    while (!isStopped()) {
      await Bun.sleep(delayMs);
      if (isStopped() || (await attemptListen())) break;
      failures += 1;
      delayMs = backoff(failures);
    }
    // Subscribers may have refetched before LISTEN was active (flag enabled
    // after boot), so repair that gap on every successful listen.
    if (client !== null) publish({ type: "resync" });
  }

  async function reconnect(previous: pg.Client) {
    if (client !== previous || isStopped()) return;
    client = null;
    await establish(1);
  }

  const hub: ChangeStream & {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    subscriberCount: () => number;
    listening: () => boolean;
  } = {
    subscribe(subscriber) {
      if (isStopped()) {
        subscriber.closed();
        return () => {
          // Nothing was registered on a stopped hub.
        };
      }
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    /**
     * Open the LISTEN connection once; later calls share the first attempt.
     * Resolves once listening, or when stopped first; it never rejects.
     */
    start() {
      started ??= establish(0);
      return started;
    },
    /** Close the connection and every subscriber; a stopped hub stays stopped. */
    async stop() {
      stopped = true;
      const current = client;
      client = null;
      for (const subscriber of subscribers) subscriber.closed();
      subscribers.clear();
      await current?.end();
    },
    subscriberCount: () => subscribers.size,
    listening: () => client !== null,
  };
  return hub;
}
export type ChangeHub = ReturnType<typeof createChangeHub>;
