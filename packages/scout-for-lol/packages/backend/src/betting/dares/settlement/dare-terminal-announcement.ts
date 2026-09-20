import { withholdDareV2Callout } from "#src/betting/dares/presentation/dare-callout-refresh-state-v2.ts";
import { enqueueTerminalDareNotification } from "#src/betting/dares/presentation/notify/dare-notification-production.ts";
import type { DareNotificationDisposition } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import type { Db } from "#src/database/index.ts";

/**
 * What a terminal Dare owes its audience, for every contract generation.
 *
 * Deliberately named for the step rather than for a generation: both the
 * version-2 and version-3 settlers end here, and a shared step living in a
 * module named after one of them reads as dead code to whoever eventually
 * retires that one.
 */
/**
 * What a Dare that just became terminal owes its audience, decided once.
 *
 * Both contract generations end the same way and for the same reason, so
 * they end in the same function: withholding is not "skip the send", it is a
 * pair of durable decisions that have to commit with the settlement — the
 * outbox row is not written, and the pending callout the capture set is
 * retired. Two copies of that is two places to get it half right, which is
 * exactly what item six's edit had to touch twice.
 */
export async function recordTerminalDareAnnouncement(
  tx: Db,
  // The settling input itself, so neither caller has to restate the same
  // seven fields: an argument list rebuilt at each call site IS the
  // duplication, just spelled as arguments.
  input: {
    dare: { id: number; potTotal: number };
    contract: { revision: number };
    matchId?: string | undefined;
    now: Date;
    notify: DareNotificationDisposition;
  },
  resolution: "achieved" | "unachieved" | "voided",
): Promise<void> {
  if (input.notify === "withhold") {
    await withholdDareV2Callout(tx, input.dare.id);
    return;
  }
  await enqueueTerminalDareNotification(tx, {
    dareId: input.dare.id,
    revision: input.contract.revision,
    potTotal: input.dare.potTotal,
    resolution,
    ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
    now: input.now,
  });
}
