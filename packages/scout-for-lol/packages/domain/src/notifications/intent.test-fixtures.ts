import {
  DiscordMessageIdSchema,
  IsoInstantSchema,
  NotificationIntentKeySchema,
} from "#src/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
} from "#src/identity/discord.ts";
import {
  NotificationAttemptNonceSchema,
  type NotificationIntent,
  type NotificationIntentState,
} from "#src/notifications/intent.ts";

/** Shared literals for the notification-intent test suites. */

export const intentKey = NotificationIntentKeySchema.parse(
  "notify:match:NA1_1234567890:channel:123456789012345678",
);
export const channelId = DiscordChannelIdSchema.parse("123456789012345678");
export const accountId = DiscordAccountIdSchema.parse("876543210987654321");
export const messageId = DiscordMessageIdSchema.parse("111111111111111111");
export const otherMessageId =
  DiscordMessageIdSchema.parse("222222222222222222");

export const nonceA = NotificationAttemptNonceSchema.parse("attempt-nonce-a");
export const nonceB = NotificationAttemptNonceSchema.parse("attempt-nonce-b");

export const createdAt = IsoInstantSchema.parse("2026-09-01T12:00:00.000Z");
export const beforeDeadline = IsoInstantSchema.parse(
  "2026-09-01T12:30:00.000Z",
);
export const exactDeadline = IsoInstantSchema.parse("2026-09-01T13:00:00.000Z");
export const afterDeadline = IsoInstantSchema.parse("2026-09-01T13:00:00.001Z");
/** Same instant as {@link afterDeadline}, written with a non-UTC offset. */
export const afterDeadlineWithOffset = IsoInstantSchema.parse(
  "2026-09-01T15:00:00.001+02:00",
);
export const deliveredAt = IsoInstantSchema.parse("2026-09-01T12:31:00.000Z");
/** Same instant as {@link deliveredAt}, without milliseconds. */
export const deliveredAtNoMillis = IsoInstantSchema.parse(
  "2026-09-01T12:31:00Z",
);
/** Same instant as {@link deliveredAt}, written with a non-UTC offset. */
export const deliveredAtWithOffset = IsoInstantSchema.parse(
  "2026-09-01T18:01:00.000+05:30",
);
export const observedAt = IsoInstantSchema.parse("2026-09-01T12:32:00.000Z");
/** Same instant as {@link observedAt}, without milliseconds. */
export const observedAtNoMillis = IsoInstantSchema.parse(
  "2026-09-01T12:32:00Z",
);
/** Same instant as {@link observedAt}, written with a non-UTC offset. */
export const observedAtWithOffset = IsoInstantSchema.parse(
  "2026-09-01T18:02:00.000+05:30",
);

export function makeIntent(state: NotificationIntentState): NotificationIntent {
  const attemptBearing =
    state.kind === "sending" || state.kind === "unknown-delivery";
  return {
    key: intentKey,
    target: { kind: "channel", channelId },
    freshnessDeadline: exactDeadline,
    createdAt,
    attemptCount: attemptBearing ? 1 : 0,
    state,
  };
}

export function sendingState(
  nonce = nonceA,
): Extract<NotificationIntentState, { kind: "sending" }> {
  return { kind: "sending", attemptNonce: nonce, startedAt: beforeDeadline };
}

export function unknownDeliveryState(
  nonce = nonceA,
): Extract<NotificationIntentState, { kind: "unknown-delivery" }> {
  return { kind: "unknown-delivery", attemptNonce: nonce, observedAt };
}

export function deliveredWithMessageState(): Extract<
  NotificationIntentState,
  { kind: "delivered" }
> {
  return { kind: "delivered", messageId, deliveredAt };
}

/** One representative state per kind, for exhaustive source-state tables. */
export function statesByKind(): Record<
  NotificationIntentState["kind"],
  NotificationIntentState
> {
  return {
    pending: { kind: "pending" },
    ready: { kind: "ready" },
    sending: sendingState(),
    delivered: deliveredWithMessageState(),
    suppressed: { kind: "suppressed", reason: "stale" },
    expired: { kind: "expired" },
    "permission-denied": { kind: "permission-denied" },
    "unknown-delivery": unknownDeliveryState(),
  };
}
