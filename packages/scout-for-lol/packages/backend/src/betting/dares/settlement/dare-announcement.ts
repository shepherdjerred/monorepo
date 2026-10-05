import { withholdDareCallout } from "#src/betting/dares/presentation/dare-callout-refresh-state.ts";
import { enqueueTerminalDareNotification } from "#src/betting/dares/presentation/notify/dare-notification-production.ts";
import {
  enqueueDareResultPostInTransaction,
  type DareNotificationDisposition,
} from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import type { DareResultAnnouncement } from "#src/betting/dares/presentation/notify/dare-status-message.ts";
import type {
  DareContributorRefund,
  DareTargetPayout,
} from "#src/betting/dares/settlement/dare-ledger.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
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
 * left standing is a post handed to the next scanner. `withholdDareCallout`
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
    await withholdDareCallout(tx, input.dareId);
    return;
  }
  await enqueue();
}
/**
 * What a Dare that just became terminal owes its audience, decided once.
 *
 * Every terminal path ends here: withholding is not "skip the send", it is a
 * pair of durable decisions that have to commit with the settlement — no
 * notification row is written, and the pending callout the capture set is
 * retired. Announcing writes both the participants' DMs and the public
 * result post in the Dare's channel.
 */
export async function recordTerminalDareAnnouncement(
  tx: Db,
  // The settling input itself, so callers do not restate the same fields: an
  // argument list rebuilt at each call site IS the duplication, just spelled
  // as arguments.
  input: {
    dare: { id: number; potTotal: number; challengerDiscordId: string };
    contract: { revision: number; plainLanguage: string };
    matchId?: string | undefined;
    now: Date;
    notify: DareNotificationDisposition;
  },
  resolution: "achieved" | "unachieved" | "voided",
  settled: DareSettledMoney,
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
      await enqueueDareResultPostInTransaction(tx, {
        dareId: input.dare.id,
        revision: input.contract.revision,
        result: dareResultAnnouncementOf({
          resolution,
          challengerDiscordId: input.dare.challengerDiscordId,
          plainLanguage: input.contract.plainLanguage,
          settled,
        }),
        ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
        occurredAt: input.now,
      });
    },
  );
}

/** What the settling transaction moved, as the public result post states it. */
export type DareSettledMoney = {
  potTotal: number;
  payouts: readonly DareTargetPayout[];
  refunds: readonly DareContributorRefund[];
  voidReason: string | null;
};

export function dareResultAnnouncementOf(input: {
  resolution: DareResultAnnouncement["resolution"];
  challengerDiscordId: string;
  plainLanguage: string;
  settled: DareSettledMoney;
}): DareResultAnnouncement {
  return {
    resolution: input.resolution,
    challengerDiscordId: DiscordAccountIdSchema.parse(
      input.challengerDiscordId,
    ),
    plainLanguage: input.plainLanguage,
    potTotal: input.settled.potTotal,
    payouts: input.settled.payouts.map((payout) => ({
      discordId: DiscordAccountIdSchema.parse(payout.discordId),
      alias: payout.alias,
      net: payout.net,
      fee: payout.fee,
    })),
    refunds: input.settled.refunds.map((refund) => ({
      discordId: DiscordAccountIdSchema.parse(refund.discordId),
      refunded: refund.refunded,
      fee: refund.fee,
    })),
    voidReason: input.settled.voidReason,
  };
}
