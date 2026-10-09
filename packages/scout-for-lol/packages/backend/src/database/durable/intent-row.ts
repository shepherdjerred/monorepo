import { z } from "zod";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
  type DiscordMessageId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationIntentSchema,
  type NotificationIntent,
  type NotificationIntentOrigin,
  type NotificationTarget,
} from "@scout-for-lol/domain/notifications/intent.ts";
import { notificationIntentCodec } from "@scout-for-lol/domain/notifications/intent-codec.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";

/**
 * Row codec for MatchNotificationIntent.
 *
 * The NotificationIntentState union is flattened into the discriminant
 * `state` column plus one column per variant payload; the migration CHECKs
 * pin each column to exactly the states that carry it. The origin union is
 * flattened the same way: `originKind` plus the batch reference a recovery
 * origin carries, CHECKed present exactly then.
 *
 * The `announcement` envelope an announcement kind carries has no column of
 * its own: it is presentation input, not machine state, nothing filters on
 * it, and the payload column already holds it. It is taken from the parsed
 * payload and the rest of the record is still cross-checked column by column. The payload column is
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

/** A Duel status has no Riot match and carries its series as the subject. */
export type DuelNotificationIntentRecord = z.infer<
  typeof DuelNotificationIntentRecordSchema
>;
export const DuelNotificationIntentRecordSchema = z.strictObject({
  duelId: z.uuid(),
  intent: NotificationIntentSchema.refine(
    (intent) =>
      intent.kind === "duel-status" &&
      intent.origin.kind === "live" &&
      intent.target.kind === "channel",
    { message: "Duel intents must be live channel duel-status announcements" },
  ),
});

/**
 * A Dare notification has a numeric Dare subject: a lifecycle or progress DM
 * to one participant, or the public result post in the Dare's own channel.
 */
export type DareNotificationIntentRecord = z.infer<
  typeof DareNotificationIntentRecordSchema
>;
export const DareNotificationIntentRecordSchema = z.strictObject({
  dareId: z.number().int().positive(),
  intent: NotificationIntentSchema.refine(
    (intent) => intent.kind === "dare-status" && intent.origin.kind === "live",
    { message: "Dare intents must be live dare-status notifications" },
  ),
});

export type NotificationIntentRecord =
  | MatchNotificationIntentRecord
  | DuelNotificationIntentRecord
  | DareNotificationIntentRecord;

/** The columns owned by the state machine, written on every transition. */
export type NotificationIntentStateColumns = {
  state: string;
  attemptCount: number;
  attemptNonce: string | null;
  sendStartedAt: Date | null;
  deliveredAt: Date | null;
  messageId: DiscordMessageId | null;
  suppressedReason: string | null;
  unknownObservedAt: Date | null;
  lastFailureClassification: string | null;
  lastFailureReason: string | null;
};

/** Column shape of a MatchNotificationIntent row, minus DB-managed columns. */
export type MatchNotificationIntentRow = NotificationIntentStateColumns & {
  intentKey: string;
  subjectKind: "match" | "duel" | "dare";
  subjectId: string;
  riotMatchId: RiotMatchId | null;
  kind: string;
  originKind: string;
  recoveryBatchId: string | null;
  targetKind: string;
  targetId: string;
  freshnessDeadline: Date;
  payload: string;
  createdAt: Date;
};

const RawIntentRowSchema = z.object({
  intentKey: z.string(),
  subjectKind: z.enum(["match", "duel", "dare"]),
  subjectId: z.string().nullable(),
  riotMatchId: z.string().nullable(),
  kind: z.string(),
  originKind: z.string(),
  recoveryBatchId: z.string().nullable(),
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

function originCandidate(raw: RawIntentRow): Record<string, unknown> {
  switch (raw.originKind) {
    case "live":
      return { kind: "live" };
    case "recovery":
      return { kind: "recovery", recoveryBatchId: raw.recoveryBatchId };
    default:
      throw new Error(`Unknown originKind column value: ${raw.originKind}`);
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

/** Rebuild the state machine from indexed columns and check its wire payload. */
function intentFromRow(raw: RawIntentRow): NotificationIntent {
  const payloadIntent = notificationIntentCodec.parse(JSON.parse(raw.payload));
  const intent = NotificationIntentSchema.parse({
    key: raw.intentKey,
    kind: raw.kind,
    origin: originCandidate(raw),
    target: targetCandidate(raw),
    freshnessDeadline: raw.freshnessDeadline.toISOString(),
    createdAt: raw.createdAt.toISOString(),
    attemptCount: raw.attemptCount,
    ...failureCandidate(raw),
    ...(payloadIntent.announcement === undefined
      ? {}
      : { announcement: payloadIntent.announcement }),
    state: stateCandidate(raw),
  });
  if (!Bun.deepEquals(intent, payloadIntent, true)) {
    throw new Error(
      `Intent ${raw.intentKey}: the payload envelope disagrees with the row's columns`,
    );
  }
  return intent;
}

export function matchNotificationIntentRowToRecord(
  row: unknown,
): MatchNotificationIntentRecord {
  const raw = RawIntentRowSchema.parse(row);
  if (
    raw.subjectKind !== "match" ||
    raw.riotMatchId === null ||
    (raw.subjectId !== null && raw.subjectId !== raw.riotMatchId)
  ) {
    throw new Error(
      `Intent ${raw.intentKey}: expected a match subject with matching subjectId and riotMatchId`,
    );
  }
  const intent = intentFromRow(raw);
  const record = MatchNotificationIntentRecordSchema.parse({
    matchId: raw.riotMatchId,
    intent,
  });
  if (
    record.intent.kind === "duel-status" ||
    record.intent.kind === "dare-status"
  ) {
    throw new Error(
      `Intent ${raw.intentKey}: ${record.intent.kind} requires a non-match subject`,
    );
  }
  return record;
}

/** Decode a stored intent without assuming its subject is a Riot match. */
export function notificationIntentRowToRecord(
  row: unknown,
): NotificationIntentRecord {
  const raw = RawIntentRowSchema.parse(row);
  if (raw.subjectKind === "match") {
    return matchNotificationIntentRowToRecord(raw);
  }
  if (raw.subjectId === null || raw.riotMatchId !== null) {
    throw new Error(
      `Intent ${raw.intentKey}: unsupported or inconsistent ${raw.subjectKind} subject`,
    );
  }
  switch (raw.subjectKind) {
    case "duel":
      return DuelNotificationIntentRecordSchema.parse({
        duelId: raw.subjectId,
        intent: intentFromRow(raw),
      });
    case "dare": {
      const dareId = Number(raw.subjectId);
      if (!Number.isSafeInteger(dareId) || String(dareId) !== raw.subjectId) {
        throw new Error(`Intent ${raw.intentKey}: invalid Dare subject ID`);
      }
      return DareNotificationIntentRecordSchema.parse({
        dareId,
        intent: intentFromRow(raw),
      });
    }
  }
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

function originColumns(origin: NotificationIntentOrigin): {
  originKind: string;
  recoveryBatchId: string | null;
} {
  switch (origin.kind) {
    case "live":
      return { originKind: "live", recoveryBatchId: null };
    case "recovery":
      return {
        originKind: "recovery",
        recoveryBatchId: origin.recoveryBatchId,
      };
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

/** Columns that have the same owner for every supported subject. */
function intentColumns(
  intent: NotificationIntent,
): Omit<
  MatchNotificationIntentRow,
  "subjectKind" | "subjectId" | "riotMatchId"
> {
  return {
    intentKey: intent.key,
    kind: intent.kind,
    ...originColumns(intent.origin),
    ...targetColumns(intent.target),
    ...notificationIntentStateColumns(intent),
    freshnessDeadline: dateFromIsoInstant(intent.freshnessDeadline),
    payload: serializeIntentPayload(intent),
    createdAt: dateFromIsoInstant(intent.createdAt),
  };
}

export function matchNotificationIntentRecordToRow(
  record: MatchNotificationIntentRecord,
): MatchNotificationIntentRow {
  if (
    record.intent.kind === "duel-status" ||
    record.intent.kind === "dare-status"
  ) {
    throw new Error(
      `Intent ${record.intent.key}: ${record.intent.kind} requires a non-match subject`,
    );
  }
  return {
    ...intentColumns(record.intent),
    subjectKind: "match",
    subjectId: record.matchId,
    riotMatchId: record.matchId,
  };
}

/** Encode either supported subject under the existing intent state columns. */
export function notificationIntentRecordToRow(
  record: NotificationIntentRecord,
): MatchNotificationIntentRow {
  if ("matchId" in record) return matchNotificationIntentRecordToRow(record);
  if ("dareId" in record) {
    return {
      ...intentColumns(record.intent),
      subjectKind: "dare",
      subjectId: record.dareId.toString(),
      riotMatchId: null,
    };
  }
  return {
    ...intentColumns(record.intent),
    subjectKind: "duel",
    subjectId: record.duelId,
    riotMatchId: null,
  };
}
