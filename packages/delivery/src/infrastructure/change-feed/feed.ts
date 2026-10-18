import { z } from "zod";
import { changeDomain } from "#shared/hub/change-contract.ts";
import type { ChangeEvent } from "#shared/hub/change-contract.ts";

/** A committed change, or a signal that changes may have been missed. */
export type FeedMessage =
  { type: "change"; change: ChangeEvent } | { type: "resync" };
export type FeedListener = (message: FeedMessage) => void;

export type ChangeFeed = {
  subscribe: (listener: FeedListener) => () => void;
};

const NotificationSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  entityId: z.string(),
});

/** Parse one `delivery_changes` NOTIFY payload written by the Audit trigger. */
export function parseNotification(payload: string): ChangeEvent {
  const raw: unknown = JSON.parse(payload);
  const notification = NotificationSchema.parse(raw);
  return { ...notification, domain: changeDomain(notification.action) };
}

/** In-process fan-out of feed messages to connected browsers. */
export function createFanout() {
  const listeners = new Set<FeedListener>();
  return {
    subscribe(listener: FeedListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(message: FeedMessage) {
      for (const listener of listeners) listener(message);
    },
    size: () => listeners.size,
  };
}
