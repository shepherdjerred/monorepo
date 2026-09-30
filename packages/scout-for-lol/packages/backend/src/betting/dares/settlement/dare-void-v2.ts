import type { Prisma } from "#generated/prisma/client/index.js";
import { announceOrWithholdDare } from "#src/betting/dares/settlement/dare-announcement.ts";
import type { DareNotificationDisposition } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import { pendingDareV2CalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state-v2.ts";
import {
  dareV2MoneyFactsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dares/settlement/dare-ledger-v2.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";

export type RefundableDareV2Row = Prisma.BucksDareV2GetPayload<{
  include: { targets: true };
}>;

export async function voidDareV2WithFullRefund(
  dare: RefundableDareV2Row,
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
    const claim = await tx.bucksDareV2.updateMany({
      where: { id: dare.id, dareState: { in: ["active", "activating"] } },
      data: {
        dareState: "voided",
        settledAt: now,
        finalValue: null,
        voidReason: reason,
        ...pendingDareV2CalloutRefresh(),
      },
    });
    if (claim.count !== 1) return false;
    const revision = await tx.bucksDareV2Revision.findUnique({
      where: {
        dareId_revision: {
          dareId: dare.id,
          revision: dare.fundedRevision ?? dare.currentRevision,
        },
      },
      select: { plainLanguage: true },
    });
    const facts = await dareV2MoneyFactsInTransaction(tx, {
      contractVersion: 2,
      dareId: dare.id,
      serverId: dare.serverId,
      potTotal: dare.potTotal,
      targetAliases: dare.targets.map((target) => target.alias),
      conditionSummary:
        revision?.plainLanguage ?? "(Dare v2 contract unreadable)",
    });
    await refundDareV2ContributionsInTransaction(tx, {
      facts,
      resolution: "voided",
      withCut: false,
      voidReason: reason,
    });
    await announceOrWithholdDare(tx, { dareId: dare.id, notify }, async () => {
      await enqueueDareNotificationInTransaction(tx, {
        dareId: dare.id,
        revision: dare.fundedRevision ?? dare.currentRevision,
        category: "lifecycle",
        kind: "voided",
        summary: `The Dare was voided (${reason.replaceAll("_", " ")}); ${dare.potTotal.toString()} Bryan Bucks were fully refunded.`,
        deduplicationKey: `dare:${dare.id.toString()}:revision:${(dare.fundedRevision ?? dare.currentRevision).toString()}:voided`,
        occurredAt: now,
      });
    });
    return true;
  });
}
