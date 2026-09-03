import type { Prisma } from "#generated/prisma/client/index.js";
import { pendingDareV2CalloutRefresh } from "#src/betting/dare-callout-refresh-state-v2.ts";
import {
  dareV2MoneyFactsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dare-ledger-v2.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dare-notification-outbox.ts";

export type RefundableDareV2Row = Prisma.BucksDareV2GetPayload<{
  include: { targets: true };
}>;

export async function voidDareV2WithFullRefund(
  dare: RefundableDareV2Row,
  reason:
    | "invalid_contract"
    | "unknown_evaluator"
    | "storage_overflow"
    | "target_unavailable",
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<boolean> {
  return await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksDareV2.updateMany({
      where: { id: dare.id, dareState: "active" },
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
    await enqueueDareNotificationInTransaction(tx, {
      dareId: dare.id,
      revision: dare.fundedRevision ?? dare.currentRevision,
      category: "lifecycle",
      kind: "voided",
      summary: `The Dare was voided (${reason.replaceAll("_", " ")}); ${dare.potTotal.toString()} Bryan Bucks were fully refunded.`,
      deduplicationKey: `dare:${dare.id.toString()}:revision:${(dare.fundedRevision ?? dare.currentRevision).toString()}:voided`,
      occurredAt: now,
    });
    return true;
  });
}
