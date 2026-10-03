import type { Prisma } from "#generated/prisma/client/index.js";
import {
  announceOrWithholdDare,
  dareResultAnnouncementOf,
} from "#src/betting/dares/settlement/dare-announcement.ts";
import {
  enqueueDareNotificationInTransaction,
  enqueueDareResultPostInTransaction,
  type DareNotificationDisposition,
} from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import { pendingDareCalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state.ts";
import {
  dareMoneyFactsInTransaction,
  refundDareContributionsInTransaction,
} from "#src/betting/dares/settlement/dare-ledger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export type RefundableDareRow = Prisma.BucksDareGetPayload<{
  include: { targets: true };
}>;

export async function voidDareWithFullRefund(
  dare: RefundableDareRow,
  reason:
    | "invalid_contract"
    | "unknown_evaluator"
    | "storage_overflow"
    | "target_unavailable"
    | "activation_timeout"
    | "insufficient_baseline"
    | "version_retired",
  prismaClient: ExtendedPrismaClient = prisma,
  options: {
    now?: Date;
    /**
     * Whether the match this void happened on is owed a public delivery. A
     * void reached from a lifecycle or activation path belongs to no match
     * and defaults to announcing, as it always did.
     */
    notify?: DareNotificationDisposition;
  } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const notify = options.notify ?? "enqueue";
  return await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksDare.updateMany({
      where: { id: dare.id, dareState: { in: ["active", "activating"] } },
      data: {
        dareState: "voided",
        settledAt: now,
        finalValue: null,
        voidReason: reason,
        ...pendingDareCalloutRefresh(),
      },
    });
    if (claim.count !== 1) return false;
    const revision = await tx.bucksDareRevision.findUnique({
      where: {
        dareId_revision: {
          dareId: dare.id,
          revision: dare.fundedRevision ?? dare.currentRevision,
        },
      },
      select: { plainLanguage: true },
    });
    const facts = await dareMoneyFactsInTransaction(tx, {
      dareId: dare.id,
      serverId: dare.serverId,
      potTotal: dare.potTotal,
      targetAliases: dare.targets.map((target) => target.alias),
      conditionSummary: revision?.plainLanguage ?? "(Dare contract unreadable)",
    });
    const refunds = await refundDareContributionsInTransaction(tx, {
      facts,
      resolution: "voided",
      withCut: false,
      voidReason: reason,
    });
    const revisionNumber = dare.fundedRevision ?? dare.currentRevision;
    await announceOrWithholdDare(tx, { dareId: dare.id, notify }, async () => {
      // A void that refunded nothing moved no money, so the callout's own
      // final state already says everything there is to say.
      if (refunds.length > 0) {
        await enqueueDareResultPostInTransaction(tx, {
          dareId: dare.id,
          revision: revisionNumber,
          result: dareResultAnnouncementOf({
            resolution: "voided",
            challengerDiscordId: dare.challengerDiscordId,
            plainLanguage: facts.conditionSummary,
            settled: {
              potTotal: facts.potTotal,
              payouts: [],
              refunds,
              voidReason: reason,
            },
          }),
          occurredAt: now,
        });
      }
      await enqueueDareNotificationInTransaction(tx, {
        dareId: dare.id,
        revision: revisionNumber,
        category: "lifecycle",
        kind: "voided",
        summary: `The Dare was voided (${reason.replaceAll("_", " ")}); ${dare.potTotal.toString()} Bryan Bucks were fully refunded.`,
        deduplicationKey: `dare:${dare.id.toString()}:revision:${revisionNumber.toString()}:voided`,
        occurredAt: now,
      });
    });
    return true;
  });
}
