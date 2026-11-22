import type { NotificationList } from "#shared/api.ts";
import {
  DELIVERY_STATES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_COPY,
  NOTIFICATION_KINDS,
  NOTIFICATION_SUBJECT,
  type DeliveryOutcome,
  type DeliveryState,
  type NotificationChannel,
  type NotificationKind,
} from "#client/presentation/notification.ts";

/** One row of `GET /api/v1/notifications`: an event on one channel. */
export type Delivery = NotificationList[number];

/** One event, with every channel it was delivered on. */
export type Notification = {
  /** The event's id, which its deliveries share. */
  id: string;
  kind: NotificationKind;
  event: Delivery["event"];
  /** When its newest delivery was queued, which is what the list is ordered by. */
  createdAt: string;
  /** In the order the channels are listed, not the order they were sent. */
  deliveries: readonly Delivery[];
  /** The reminder in Media that is waiting to be read, if there is one. */
  unread: Delivery | null;
};

/** The most deliveries one read of the list returns. */
export const DELIVERY_CAP = 100;

function oneOf<Value extends string>(
  allowed: readonly Value[],
  value: string,
  what: string,
): Value {
  const known = allowed.find((candidate) => candidate === value);
  if (known === undefined) throw new Error(`Unknown ${what} "${value}"`);
  return known;
}

/*
 * The API types these three as strings. A value outside the lists is a
 * contract this client does not know, so it fails here instead of being
 * shown under a guessed label.
 */
export function notificationKind(kind: string): NotificationKind {
  return oneOf(NOTIFICATION_KINDS, kind, "notification kind");
}
export function deliveryChannel(channel: string): NotificationChannel {
  return oneOf(NOTIFICATION_CHANNELS, channel, "notification channel");
}
export function deliveryState(state: string): DeliveryState {
  return oneOf(DELIVERY_STATES, state, "delivery state");
}

/**
 * A reminder shown in Media that its reader has not acknowledged. The two
 * values are compared as sent: the bell counts these on every page, and a
 * delivery it does not understand is simply not one of them.
 */
function isUnread(delivery: Delivery): boolean {
  const channel: NotificationChannel = "in_app";
  const state: DeliveryState = "pending";
  return delivery.channel === channel && delivery.state === state;
}

/**
 * The list as one entry per event. The API sends one row per channel an
 * event went out on; rows that share an event's id are that one event.
 * Events stay in the order their newest row arrived in, which is newest
 * first, and nothing but the id is used to tell two events apart: two
 * events of one kind about one title are two notifications.
 */
export function groupNotifications(rows: readonly Delivery[]): Notification[] {
  const groups = new Map<string, Delivery[]>();
  for (const row of rows) {
    const group = groups.get(row.event.id);
    if (group === undefined) groups.set(row.event.id, [row]);
    else group.push(row);
  }
  return [...groups.entries()].map(([id, deliveries]) => {
    const [first] = deliveries;
    if (first === undefined) throw new Error(`Event ${id} has no delivery`);
    // Every channel is read here, so one this client does not know fails
    // even when it is the event's only one.
    const ordered = deliveries
      .map((delivery) => ({
        delivery,
        place: NOTIFICATION_CHANNELS.indexOf(deliveryChannel(delivery.channel)),
      }))
      .sort((left, right) => left.place - right.place)
      .map(({ delivery }) => delivery);
    return {
      id,
      kind: notificationKind(first.event.kind),
      event: first.event,
      createdAt: first.createdAt,
      deliveries: ordered,
      unread: ordered.find((delivery) => isUnread(delivery)) ?? null,
    };
  });
}

/** How many events are waiting to be read: the number on the bell. */
export function unreadCount(rows: readonly Delivery[]): number {
  return new Set(rows.filter((row) => isUnread(row)).map((row) => row.event.id))
    .size;
}

/**
 * Whether the list may have been cut short. The API returns at most its cap
 * of deliveries and does not say whether more exist, so only an answer that
 * is exactly full can be hiding older ones.
 */
export function isCutOff(rows: readonly Delivery[]): boolean {
  return rows.length === DELIVERY_CAP;
}

function capitalized(sentence: string): string {
  return sentence.replace(/^./u, (letter) => letter.toUpperCase());
}

/** What happened, as the entry's one sentence. */
export function notificationTitle(notification: Notification): string {
  const copy = NOTIFICATION_COPY[notification.kind];
  const { media } = notification.event;
  return media === null
    ? copy.unnamed
    : capitalized(copy.about(NOTIFICATION_SUBJECT[media.kind](media)));
}

/** How one delivery ended up, for the word after its channel's name. */
export function deliveryOutcome(delivery: Delivery): DeliveryOutcome {
  const state = deliveryState(delivery.state);
  if (deliveryChannel(delivery.channel) === "in_app") {
    return state === "pending" ? "unread" : "read";
  }
  // The mail provider's own verdict outranks the fact that it took the mail.
  if (delivery.providerStatus === "bounced") return "bounced";
  switch (state) {
    case "pending": {
      return "waiting";
    }
    case "sending": {
      return "sending";
    }
    case "failed": {
      return "failed";
    }
    case "unknown": {
      return "unconfirmed";
    }
    case "accepted": {
      return delivery.providerStatus === "delivered" ? "delivered" : "sent";
    }
  }
}

/** A delivery its reader may need to do something about. */
export function needsAttention(delivery: Delivery): boolean {
  const outcome = deliveryOutcome(delivery);
  return (
    outcome === "bounced" ||
    outcome === "failed" ||
    outcome === "unconfirmed" ||
    outcome === "sending"
  );
}
