import type { Db } from "#src/database/index.ts";
import {
  NotificationIntentKeySchema,
  type NotificationIntentKey,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { NotificationIntent } from "@scout-for-lol/domain/notifications/intent.ts";
import type { NotificationTransitionResult } from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import {
  matchNotificationIntentRecordToRow,
  matchNotificationIntentRowToRecord,
  notificationIntentTransitionPatch,
  type MatchNotificationIntentRecord,
} from "#src/database/durable/intent-row.ts";

/**
 * Repository for MatchNotificationIntent.
 *
 * Writes follow the confirmation-intent claimAndExecute idiom: the domain
 * transition decides legality over a parsed snapshot, and the update is
 * guarded by the exact state that snapshot observed (discriminant, attempt
 * count, attempt nonce), so a racing writer's transition either applies to
 * the state it actually saw or comes back as the domain's own
 * `already-applied`/`conflict` answer after a re-read.
 */

const TRANSITION_ATTEMPTS = 3;

export type UpsertIntentResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "intent-differs" };

/**
 * Ensure the intent row exists. A byte-identical retry is `already-applied`;
 * an existing row with different facts is a conflict, because an intent key
 * is minted for exactly one decision to notify.
 */
export async function upsertIntent(
  db: Db,
  record: MatchNotificationIntentRecord,
): Promise<UpsertIntentResult> {
  const row = matchNotificationIntentRecordToRow(record);
  const created = await db.matchNotificationIntent.createMany({
    data: [row],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return { outcome: "applied" };
  }
  const existing = await db.matchNotificationIntent.findUnique({
    where: { intentKey: row.intentKey },
  });
  if (existing === null) {
    throw new Error(
      `MatchNotificationIntent ${row.intentKey} vanished between a duplicate insert and its read-back`,
    );
  }
  const existingRow = matchNotificationIntentRecordToRow(
    matchNotificationIntentRowToRecord(existing),
  );
  return Bun.deepEquals(existingRow, row, true)
    ? { outcome: "already-applied" }
    : { outcome: "conflict", reason: "intent-differs" };
}

export async function getIntent(
  db: Db,
  args: { intentKey: NotificationIntentKey },
): Promise<MatchNotificationIntentRecord | null> {
  const row = await db.matchNotificationIntent.findUnique({
    where: { intentKey: args.intentKey },
  });
  return row === null ? null : matchNotificationIntentRowToRecord(row);
}

/**
 * Every intent minted for one match, in a stable order.
 *
 * This is the read a fan-out needs and `getIntent` cannot serve: a caller that
 * had to name the keys before it could look them up would miss any intent
 * another producer minted, and would re-mint keys for intents that already
 * exist. The `riotMatchId` index is what makes it a lookup rather than a scan.
 *
 * Ordered by `intentKey` rather than by insertion: the order becomes the order
 * notification children are started in, so it must be a property of the data
 * and not of which producer happened to write first.
 */
export async function listIntentsForMatch(
  db: Db,
  args: { matchId: RiotMatchId },
): Promise<MatchNotificationIntentRecord[]> {
  const rows = await db.matchNotificationIntent.findMany({
    where: { riotMatchId: args.matchId },
    orderBy: { intentKey: "asc" },
  });
  return rows.map((row) => matchNotificationIntentRowToRecord(row));
}

/**
 * The states an intent can be expired from: work never attempted.
 *
 * `sending` and `unknown-delivery` are deliberately absent. Both name an
 * attempt whose outcome is not yet known, and the domain's `expire` refuses
 * them (`send-in-flight`, `unknown-delivery-requires-operator`); selecting
 * them would spend the batch on rows the sweep can never move and would
 * starve the ones it can.
 */
const EXPIRABLE_INTENT_STATES = [
  "pending",
  "ready",
] as const satisfies readonly NotificationIntent["state"]["kind"][];

/**
 * Keys of unattempted intents whose freshness deadline passed before `now`,
 * the most overdue first.
 *
 * Strictly before, because `beginSend` refuses only a start strictly after
 * the deadline: an intent AT its deadline can still be sent. Rides the
 * `(state, freshnessDeadline)` index; the key breaks ties because intents
 * minted for one match share a deadline to the millisecond.
 */
export async function listOverdueIntentKeys(
  db: Db,
  args: { now: Date; limit: number },
): Promise<NotificationIntentKey[]> {
  const rows = await db.matchNotificationIntent.findMany({
    where: {
      state: { in: [...EXPIRABLE_INTENT_STATES] },
      freshnessDeadline: { lt: args.now },
    },
    select: { intentKey: true },
    orderBy: [{ freshnessDeadline: "asc" }, { intentKey: "asc" }],
    take: args.limit,
  });
  return rows.map((row) => NotificationIntentKeySchema.parse(row.intentKey));
}

/**
 * Unattempted, still-fresh channel intents of `kinds`, oldest first.
 *
 * The candidates for the retirement sweep. The same unattempted states as
 * expiry, and for the same reason: an attempted intent is never retired, so
 * selecting one would spend the batch on a row the domain must refuse.
 * Overdue intents are left to expiry, which runs first, so the two sweeps
 * never contend for one row. Rides the `(state, freshnessDeadline)` index.
 */
export async function listRetirableIntents(
  db: Db,
  args: {
    now: Date;
    kinds: readonly NotificationIntent["kind"][];
    limit: number;
  },
): Promise<MatchNotificationIntentRecord[]> {
  const rows = await db.matchNotificationIntent.findMany({
    where: {
      state: { in: [...EXPIRABLE_INTENT_STATES] },
      freshnessDeadline: { gte: args.now },
      kind: { in: [...args.kinds] },
      targetKind: "channel",
    },
    orderBy: [{ createdAt: "asc" }, { intentKey: "asc" }],
    take: args.limit,
  });
  return rows.map((row) => matchNotificationIntentRowToRecord(row));
}

function observedAttemptNonce(intent: NotificationIntent): string | null {
  const state = intent.state;
  return state.kind === "sending" || state.kind === "unknown-delivery"
    ? state.attemptNonce
    : null;
}

/**
 * Apply one pure domain transition to the stored intent.
 *
 * Reads the row, runs `transition` over the parsed domain value, and writes
 * the applied result with an update guarded by everything the snapshot
 * observed. A guard miss means a concurrent writer moved the intent first;
 * the transition is then re-evaluated against the fresh state, which turns a
 * lost race into the domain's own answer (`already-applied` for an identical
 * retry, `conflict` otherwise). Transitioning an intent that was never
 * upserted is a broken caller contract and throws.
 */
export async function transitionIntent(
  db: Db,
  args: {
    intentKey: NotificationIntentKey;
    transition: (intent: NotificationIntent) => NotificationTransitionResult;
  },
): Promise<NotificationTransitionResult> {
  for (let attempt = 0; attempt < TRANSITION_ATTEMPTS; attempt += 1) {
    const row = await db.matchNotificationIntent.findUnique({
      where: { intentKey: args.intentKey },
    });
    if (row === null) {
      throw new Error(
        `Cannot transition ${args.intentKey}: the intent was never upserted`,
      );
    }
    const record = matchNotificationIntentRowToRecord(row);
    const result = args.transition(record.intent);
    if (result.outcome !== "applied") {
      return result;
    }
    const updated = await db.matchNotificationIntent.updateMany({
      where: {
        intentKey: args.intentKey,
        state: record.intent.state.kind,
        attemptCount: record.intent.attemptCount,
        attemptNonce: observedAttemptNonce(record.intent),
      },
      data: notificationIntentTransitionPatch(result.next),
    });
    if (updated.count === 1) {
      return result;
    }
  }
  throw new Error(
    `Gave up transitioning ${args.intentKey} after ${String(TRANSITION_ATTEMPTS)} contended attempts`,
  );
}
