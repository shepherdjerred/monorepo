import type { Prisma } from "#generated/prisma/client/index.js";
import { DARE_WINDOW_INGESTION_GRACE_MS } from "#src/betting/constants.ts";
import { pendingDareV2CalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state-v2.ts";
import {
  dareV2MoneyFactsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dares/settlement/dare-ledger-v2.ts";
import { settleActiveDareV2AtBound } from "#src/betting/dares/settlement/dare-settle-v2.ts";
import {
  DareV2PartialSettlementError,
  type DareV2SettlementSummary,
} from "#src/betting/dares/settlement/dare-settle-types-v2.ts";
import { collectDareV2Batch } from "#src/betting/dares/settlement/dare-settle-batch-v2.ts";
import { voidDareV2WithFullRefund } from "#src/betting/dares/settlement/dare-void-v2.ts";
import { readableRelationalDareContract } from "#src/betting/dares/dare-v2-common.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dares/presentation/dare-notification-outbox.ts";

const logger = createLogger("betting-dare-sweep-v2");

type PendingDareV2 = Prisma.BucksDareV2GetPayload<{
  include: { targets: true };
}>;

function hasReadableContract(raw: string | null): boolean {
  return readableRelationalDareContract(raw) !== null;
}

async function expireOne(
  dare: PendingDareV2,
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<boolean> {
  return await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksDareV2.updateMany({
      where: {
        id: dare.id,
        dareState: "pending_accept",
        acceptDeadline: { lt: now },
      },
      data: {
        dareState: "expired",
        settledAt: now,
        ...pendingDareV2CalloutRefresh(),
      },
    });
    if (claim.count !== 1) return false;
    const revision = await tx.bucksDareV2Revision.findUniqueOrThrow({
      where: {
        dareId_revision: {
          dareId: dare.id,
          revision: dare.fundedRevision ?? dare.currentRevision,
        },
      },
    });
    const facts = await dareV2MoneyFactsInTransaction(tx, {
      contractVersion: 2,
      dareId: dare.id,
      serverId: dare.serverId,
      potTotal: dare.potTotal,
      targetAliases: dare.targets.map((target) => target.alias),
      conditionSummary: revision.plainLanguage,
    });
    await refundDareV2ContributionsInTransaction(tx, {
      facts,
      resolution: "expired",
      withCut: false,
    });
    await enqueueDareNotificationInTransaction(tx, {
      dareId: dare.id,
      revision: dare.fundedRevision ?? dare.currentRevision,
      category: "lifecycle",
      kind: "expired",
      summary: `The acceptance window expired; ${dare.potTotal.toString()} Bryan Bucks were fully refunded.`,
      deduplicationKey: `dare:${dare.id.toString()}:revision:${(dare.fundedRevision ?? dare.currentRevision).toString()}:expired`,
      occurredAt: now,
    });
    return true;
  });
}

export async function expireDareV2AcceptWindows(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<number[]> {
  const rows = await prismaClient.bucksDareV2.findMany({
    where: { dareState: "pending_accept", acceptDeadline: { lt: now } },
    include: { targets: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const expired: number[] = [];
  for (const row of rows) {
    if (await expireOne(row, prismaClient, now)) expired.push(row.id);
  }
  return expired;
}

export async function settleEndedDareV2Windows(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareV2SettlementSummary[]> {
  const cutoff = new Date(now.getTime() - DARE_WINDOW_INGESTION_GRACE_MS);
  const rows = await prismaClient.bucksDareV2.findMany({
    where: { dareState: "active", deadlineAt: { lt: cutoff } },
    include: { targets: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const batch = await collectDareV2Batch(
    rows,
    async (row): Promise<DareV2SettlementSummary | undefined> => {
      if (hasReadableContract(row.contractJson)) {
        return await settleActiveDareV2AtBound(row, prismaClient, now);
      }
      const voided = await voidDareV2WithFullRefund(
        row,
        "invalid_contract",
        prismaClient,
        now,
      );
      return voided
        ? {
            contractVersion: 2,
            dareId: row.id,
            serverId: row.serverId,
            channelId: row.channelId,
            resolution: "voided",
            value: null,
            finality: { value: null, final: true, reason: "contract_error" },
            proof: null,
          }
        : undefined;
    },
    (row, error) => {
      logger.error(
        `Failed to settle ended Dare v2 ${row.id.toString()}:`,
        error,
      );
    },
  );
  const summaries = batch.values.filter((summary) => summary !== undefined);
  if (batch.firstFailure !== null) {
    throw new DareV2PartialSettlementError(summaries, batch.firstFailure.error);
  }
  return summaries;
}
