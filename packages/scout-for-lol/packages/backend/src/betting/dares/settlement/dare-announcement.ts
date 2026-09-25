import { withholdDareV2Callout } from "#src/betting/dares/presentation/dare-callout-refresh-state-v2.ts";
import { enqueueTerminalDareNotification } from "#src/betting/dares/presentation/notify/dare-notification-production.ts";
import type { DareNotificationDisposition } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import type { Db } from "#src/database/index.ts";

/**
 * What a Dare owes its audience, for every contract generation and at every
 * stage that produces something to say.
 *
 * Deliberately named for neither a generation nor a single stage: both
 * settlers end here, both also pass through it when a capture is not yet
 * final, and a shared step living in a module named after one caller reads
 * as dead code to whoever retires that caller.
 */

/**
 * Enqueue what this step produced, or withhold it durably.
 *
 * The one rule every Dare announcement obeys, so that "silent" means the same
 * thing at each stage. Withholding is not "skip the send": the row is not
 * written AND the pending callout the step set is retired, because a flag
 * left standing is a post handed to the next scanner. `withholdDareV2Callout`
 * only retires a Dare with no public callout yet, so an existing one is still
 * edited — suppressing that would leave a stale message rather than withhold
 * a new one.
 */
export async function announceOrWithholdDare(
  tx: Db,
  input: { dareId: number; notify: DareNotificationDisposition },
  enqueue: () => Promise<void>,
): Promise<void> {
  if (input.notify === "withhold") {
    await withholdDareV2Callout(tx, input.dareId);
    return;
  }
  await enqueue();
}
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
  await announceOrWithholdDare(
    tx,
    { dareId: input.dare.id, notify: input.notify },
    async () => {
      await enqueueTerminalDareNotification(tx, {
        dareId: input.dare.id,
        revision: input.contract.revision,
        potTotal: input.dare.potTotal,
        resolution,
        ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
        now: input.now,
      });
    },
  );
}
