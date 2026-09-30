import type { Db } from "#src/database/index.ts";
import { mintDareStatusIntents } from "#src/betting/dares/presentation/notify/dare-status-intent.ts";
import type { DareNotificationEventInput } from "#src/betting/dares/presentation/notify/dare-status-message.ts";

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
