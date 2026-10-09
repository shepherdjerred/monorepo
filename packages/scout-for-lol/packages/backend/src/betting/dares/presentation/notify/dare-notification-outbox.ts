import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { Db } from "#src/database/index.ts";
import {
  mintDareResultIntent,
  mintDareStatusIntents,
} from "#src/betting/dares/presentation/notify/dare-status-intent.ts";
import type {
  DareNotificationEventInput,
  DareResultAnnouncement,
} from "#src/betting/dares/presentation/notify/dare-status-message.ts";

/**
 * Whether a settling transaction may write its Dare notification.
 *
 * Threaded rather than decided at the outbox, because only the caller knows
 * whether the MATCH it is settling is owed a public delivery. Spelled as two
 * words rather than a boolean so the call sites read as a decision and a
 * `false` cannot be mistaken for "not yet".
 */
export type DareNotificationDisposition = "enqueue" | "withhold";

export async function enqueueDareNotificationInTransaction(
  tx: Db,
  input: DareNotificationEventInput,
): Promise<void> {
  await mintDareStatusIntents(tx, input);
}

/**
 * Record the public result post a resolved Dare owes its own channel.
 *
 * Written in the settling transaction beside the DM record, so a Dare that
 * resolved always owes exactly one channel post and a rolled-back settlement
 * owes none. Delivery re-checks `dare_notifications_enabled` before sending.
 */
export async function enqueueDareResultPostInTransaction(
  tx: Db,
  input: {
    dareId: number;
    revision: number;
    result: DareResultAnnouncement;
    matchId?: RiotMatchId | undefined;
    occurredAt: Date;
  },
): Promise<void> {
  await mintDareResultIntent(tx, input);
}
