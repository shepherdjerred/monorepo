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
 * a client never refetches before a write is visible. A supervisor loop owns
 * the connection: when it drops, the loop reconnects with backoff and sends
 * `resync`, because notifications sent while disconnected are lost.
 */
export function createChangeHub(connectionString: string) {
  const subscribers = new Set<HubSubscriber>();
  let client: pg.Client | null = null;
  let supervision: Promise<void> | undefined;
  let stopped = false;
  const isStopped = () => stopped;
  const firstListen = Promise.withResolvers<undefined>();

  function publish(message: HubMessage) {
    for (const subscriber of subscribers) subscriber.message(message);
  }

  function onNotification(notification: pg.Notification) {
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
  }

  /**
   * One connection attempt. `lost` settles when the connection errors or
   * ends; `live` is false when the attempt failed and was cleaned up.
   */
  async function dial() {
    const next = new pg.Client({
      connectionString,
      application_name: CHANGE_HUB_APPLICATION,
      keepAlive: true,
    });
    const lost = new Promise<void>((resolve) => {
      next.on("error", (error) => {
        logEvent("artifacts_live_updates_connection_error", {
          errorType: error.name,
        });
        resolve();
      });
      next.once("end", resolve);
    });
    next.on("notification", onNotification);
    try {
      await next.connect();
      await next.query(`LISTEN ${CHANGE_CHANNEL}`);
      return { next, lost, live: true };
    } catch (error) {
      logEvent("artifacts_live_updates_connect_failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await next.end().catch(() => null);
      return { next, lost, live: false };
    }
  }

  /** Runs until stopped and never rejects; a database outage only delays it. */
  async function supervise() {
    let failures = 0;
    while (!isStopped()) {
      await Bun.sleep(failures === 0 ? 0 : backoff(failures));
      if (isStopped()) break;
      const attempt = await dial();
      if (!attempt.live) {
        failures += 1;
        continue;
      }
      if (isStopped()) {
        await attempt.next.end();
        break;
      }
      client = attempt.next;
      failures = 1;
      // A reader may have refetched before LISTEN was active.
      publish({ type: "resync" });
      firstListen.resolve(undefined);
      await attempt.lost;
      if (client === attempt.next) client = null;
    }
    firstListen.resolve(undefined);
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
    /** Resolves once listening, or when stopped first; it never rejects. */
    start() {
      supervision ??= supervise();
      return firstListen.promise;
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
