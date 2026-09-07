import { z } from "zod";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationIntentSchema,
  type NotificationIntent,
  type NotificationTarget,
} from "@scout-for-lol/domain/notifications/intent.ts";
import { notificationIntentCodec } from "@scout-for-lol/domain/notifications/intent-codec.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";

/**
 * Row codec for MatchNotificationIntent.
 *
 * The NotificationIntentState union is flattened into the discriminant
 * `state` column plus one column per variant payload; the migration CHECKs
 * pin each column to exactly the states that carry it. The payload column is
 * the notificationIntentCodec envelope of the same intent — the versioned
 * wire form that survives schema evolution — and every read parses it
 * through the codec (kind and version verified, data validated) and
 * cross-checks it against the columns, so neither representation can
 * silently drift and no foreign envelope can hide in an intent row.
 */

export type MatchNotificationIntentRecord = z.infer<
  typeof MatchNotificationIntentRecordSchema
>;
export const MatchNotificationIntentRecordSchema = z.strictObject({
  matchId: RiotMatchIdSchema,
  intent: NotificationIntentSchema,
});

/** The columns owned by the state machine, written on every transition. */
export type NotificationIntentStateColumns = {
  state: string;
  attemptCount: number;
  attemptNonce: string | null;
  sendStartedAt: Date | null;
  deliveredAt: Date | null;
  messageId: string | null;
  suppressedReason: string | null;
  unknownObservedAt: Date | null;
  lastFailureClassification: string | null;
  lastFailureReason: string | null;
};

/** Column shape of a MatchNotificationIntent row, minus DB-managed columns. */
export type MatchNotificationIntentRow = NotificationIntentStateColumns & {
  intentKey: string;
  riotMatchId: string;
  targetKind: string;
  targetId: string;
  freshnessDeadline: Date;
  payload: string;
  createdAt: Date;
};

const RawIntentRowSchema = z.object({
  intentKey: z.string(),
  riotMatchId: z.string(),
  targetKind: z.string(),
  targetId: z.string(),
  state: z.string(),
  attemptCount: z.number().int(),
  attemptNonce: z.string().nullable(),
  sendStartedAt: z.date().nullable(),
  deliveredAt: z.date().nullable(),
  messageId: z.string().nullable(),
  suppressedReason: z.string().nullable(),
  unknownObservedAt: z.date().nullable(),
  lastFailureClassification: z.string().nullable(),
  lastFailureReason: z.string().nullable(),
  freshnessDeadline: z.date(),
  payload: z.string(),
  createdAt: z.date(),
});
type RawIntentRow = z.infer<typeof RawIntentRowSchema>;

function targetCandidate(raw: RawIntentRow): Record<string, unknown> {
  switch (raw.targetKind) {
    case "channel":
      return { kind: "channel", channelId: raw.targetId };
    case "dm":
      return { kind: "dm", accountId: raw.targetId };
    default:
      throw new Error(`Unknown targetKind column value: ${raw.targetKind}`);
  }
}

function stateCandidate(raw: RawIntentRow): Record<string, unknown> {
  switch (raw.state) {
    case "pending":
    case "ready":
    case "expired":
    case "permission-denied":
      return { kind: raw.state };
    case "sending":
      return {
        kind: "sending",
        attemptNonce: raw.attemptNonce,
        startedAt: raw.sendStartedAt?.toISOString(),
      };
    case "delivered":
      return {
        kind: "delivered",
        deliveredAt: raw.deliveredAt?.toISOString(),
        ...(raw.messageId === null ? {} : { messageId: raw.messageId }),
      };
    case "suppressed":
      return { kind: "suppressed", reason: raw.suppressedReason };
    case "unknown-delivery":
      return {
        kind: "unknown-delivery",
        attemptNonce: raw.attemptNonce,
        observedAt: raw.unknownObservedAt?.toISOString(),
      };
    default:
      throw new Error(`Unknown intent state column value: ${raw.state}`);
  }
}

function failureCandidate(raw: RawIntentRow): Record<string, unknown> {
  if (
    raw.lastFailureClassification === null &&
    raw.lastFailureReason === null
  ) {
    return {};
  }
  return {
    lastFailure: {
      classification: raw.lastFailureClassification,
      reason: raw.lastFailureReason,
    },
  };
}

/** The payload column's content: the codec envelope, serialized. */
export function serializeIntentPayload(intent: NotificationIntent): string {
  return JSON.stringify(notificationIntentCodec.serialize(intent));
}

export function matchNotificationIntentRowToRecord(
  row: unknown,
): MatchNotificationIntentRecord {
  const raw = RawIntentRowSchema.parse(row);
  const record = MatchNotificationIntentRecordSchema.parse({
    matchId: raw.riotMatchId,
    intent: {
      key: raw.intentKey,
      target: targetCandidate(raw),
      freshnessDeadline: raw.freshnessDeadline.toISOString(),
      createdAt: raw.createdAt.toISOString(),
      attemptCount: raw.attemptCount,
      ...failureCandidate(raw),
      state: stateCandidate(raw),
    },
  });
  const payloadIntent = notificationIntentCodec.parse(JSON.parse(raw.payload));
  if (!Bun.deepEquals(record.intent, payloadIntent, true)) {
    throw new Error(
      `Intent ${raw.intentKey}: the payload envelope disagrees with the row's columns`,
    );
  }
  return record;
}

function targetColumns(target: NotificationTarget): {
  targetKind: string;
  targetId: string;
} {
  switch (target.kind) {
    case "channel":
      return { targetKind: "channel", targetId: target.channelId };
    case "dm":
      return { targetKind: "dm", targetId: target.accountId };
  }
}

/**
 * The state-machine columns for one domain intent. Shared by the full row
 * mapper and by transitionIntent's guarded update patch, so a transition can
 * never write a column set that disagrees with what a fresh insert would.
 */
export function notificationIntentStateColumns(
  intent: NotificationIntent,
): NotificationIntentStateColumns {
  const state = intent.state;
  const base: NotificationIntentStateColumns = {
    state: state.kind,
    attemptCount: intent.attemptCount,
    attemptNonce: null,
    sendStartedAt: null,
    deliveredAt: null,
    messageId: null,
    suppressedReason: null,
    unknownObservedAt: null,
    lastFailureClassification: intent.lastFailure?.classification ?? null,
    lastFailureReason: intent.lastFailure?.reason ?? null,
  };
  switch (state.kind) {
    case "pending":
    case "ready":
    case "expired":
    case "permission-denied":
      return base;
    case "sending":
      return {
        ...base,
        attemptNonce: state.attemptNonce,
        sendStartedAt: dateFromIsoInstant(state.startedAt),
      };
    case "delivered":
      return {
        ...base,
        deliveredAt: dateFromIsoInstant(state.deliveredAt),
        messageId: state.messageId ?? null,
      };
    case "suppressed":
      return { ...base, suppressedReason: state.reason };
    case "unknown-delivery":
      return {
        ...base,
        attemptNonce: state.attemptNonce,
        unknownObservedAt: dateFromIsoInstant(state.observedAt),
      };
  }
}

/**
 * Everything a transition rewrites: the state-machine columns plus the
 * payload envelope, which encodes the same intent and must move with it.
 */
export function notificationIntentTransitionPatch(
  intent: NotificationIntent,
): NotificationIntentStateColumns & { payload: string } {
  return {
    ...notificationIntentStateColumns(intent),
    payload: serializeIntentPayload(intent),
  };
}

export function matchNotificationIntentRecordToRow(
  record: MatchNotificationIntentRecord,
): MatchNotificationIntentRow {
  return {
    intentKey: record.intent.key,
    riotMatchId: record.matchId,
    ...targetColumns(record.intent.target),
    ...notificationIntentStateColumns(record.intent),
    freshnessDeadline: dateFromIsoInstant(record.intent.freshnessDeadline),
    payload: serializeIntentPayload(record.intent),
    createdAt: dateFromIsoInstant(record.intent.createdAt),
  };
}
