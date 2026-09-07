import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { NotificationIntentKey } from "@scout-for-lol/domain/identity/brands.ts";
import type { NotificationIntent } from "@scout-for-lol/domain/notifications/intent.ts";
import type { NotificationTransitionResult } from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import {
  matchNotificationIntentRecordToRow,
  matchNotificationIntentRowToRecord,
  notificationIntentStateColumns,
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

type IntentDb = Pick<ExtendedPrismaClient, "matchNotificationIntent">;

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
  db: IntentDb,
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
  db: IntentDb,
  args: { intentKey: NotificationIntentKey },
): Promise<MatchNotificationIntentRecord | null> {
  const row = await db.matchNotificationIntent.findUnique({
    where: { intentKey: args.intentKey },
  });
  return row === null ? null : matchNotificationIntentRowToRecord(row);
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
  db: IntentDb,
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
      data: notificationIntentStateColumns(result.next),
    });
    if (updated.count === 1) {
      return result;
    }
  }
  throw new Error(
    `Gave up transitioning ${args.intentKey} after ${String(TRANSITION_ATTEMPTS)} contended attempts`,
  );
}
