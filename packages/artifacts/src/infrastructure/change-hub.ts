import pg from "pg";
import { z } from "zod";
import { logEvent, reportError } from "./log.ts";

export const CHANGE_CHANNEL = "artifacts_events";
export const CHANGE_HUB_APPLICATION = "artifacts-live-updates";
const MAX_BACKOFF_MS = 30_000;

/** The ids-only payload the `Event` trigger notifies. */
const NotificationSchema = z.object({
  seq: z.number().int(),
  boardId: z.string().nullable(),
  kind: z.string(),
});

export type HubMessage =
  | { type: "event"; seq: number; boardId: string | null; kind: string }
  | { type: "resync" };

export type HubSubscriber = {
  message: (message: HubMessage) => void;
  closed: () => void;
};

const backoff = (failures: number) =>
  Math.min(MAX_BACKOFF_MS, 250 * 2 ** failures);

/**
 * Listens for committed `Event` rows on one dedicated connection and fans
 * them out in process. NOTIFY is delivered on commit and in commit order, so
 * a client never refetches before a write is visible. After a dropped
 * connection the hub reconnects and sends `resync`, because notifications
 * sent while disconnected are lost.
 */
export function createChangeHub(connectionString: string) {
  const subscribers = new Set<HubSubscriber>();
  let client: pg.Client | null = null;
  let started: Promise<void> | undefined;
  let stopped = false;
  const isStopped = () => stopped;

  function publish(message: HubMessage) {
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
      try {
        const parsed = NotificationSchema.parse(
          JSON.parse(notification.payload ?? ""),
        );
        publish({ type: "event", ...parsed });
      } catch (error) {
        // The trigger and this schema are one contract; a mismatch is a bug.
        // The change committed, so subscribers refetch.
        reportError(error, "artifacts_live_updates_payload_invalid");
        publish({ type: "resync" });
      }
    });
    next.on("error", (error) => {
      logEvent("artifacts_live_updates_connection_error", {
        errorType: error.name,
      });
      void reconnect(next);
    });
    next.on("end", () => {
      void reconnect(next);
    });
    return next;
  }

  async function attemptListen() {
    const next = listen();
    try {
      await next.connect();
      await next.query(`LISTEN ${CHANGE_CHANNEL}`);
      if (isStopped()) {
        await next.end();
        return true;
      }
      client = next;
      return true;
    } catch (error) {
      logEvent("artifacts_live_updates_connect_failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await next.end().catch(() => null);
      return false;
    }
  }

  /** Retries with backoff until listening or stopped; never rejects. */
  async function establish(failures: number) {
    let delayMs = failures === 0 ? 0 : backoff(failures);
    while (!isStopped()) {
      await Bun.sleep(delayMs);
      if (isStopped() || (await attemptListen())) break;
      failures += 1;
      delayMs = backoff(failures);
    }
    // A reader may have refetched before LISTEN was active.
    if (client !== null) publish({ type: "resync" });
  }

  async function reconnect(previous: pg.Client) {
    if (client !== previous || isStopped()) return;
    client = null;
    await establish(1);
  }

  return {
    subscribe(subscriber: HubSubscriber) {
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
    start() {
      started ??= establish(0);
      return started;
    },
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
}
export type ChangeHub = ReturnType<typeof createChangeHub>;
