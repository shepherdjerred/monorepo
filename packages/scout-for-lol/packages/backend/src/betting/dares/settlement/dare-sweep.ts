import type { Prisma } from "#generated/prisma/client/index.js";
import { DARE_WINDOW_INGESTION_GRACE_MS } from "#src/betting/constants.ts";
import { pendingDareCalloutRefresh } from "#src/betting/dares/presentation/dare-callout-refresh-state.ts";
import {
  dareMoneyFactsInTransaction,
  refundDareContributionsInTransaction,
} from "#src/betting/dares/settlement/dare-ledger.ts";
import { settleActiveDareAtBound } from "#src/betting/dares/settlement/dare-settle.ts";
import {
  DarePartialSettlementError,
  type DareSettlementSummary,
} from "#src/betting/dares/settlement/dare-settle-types.ts";
import { collectDareBatch } from "#src/betting/dares/settlement/dare-settle-batch.ts";
import { voidDareWithFullRefund } from "#src/betting/dares/settlement/dare-void.ts";
import { readableRelationalDareContract } from "#src/betting/dares/dare-common.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { enqueueDareNotificationInTransaction } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";

const logger = createLogger("betting-dare-sweep-v2");

type PendingDare = Prisma.BucksDareGetPayload<{
  include: { targets: true };
}>;

function hasReadableContract(raw: string | null): boolean {
  return readableRelationalDareContract(raw) !== null;
}

async function expireOne(
  dare: PendingDare,
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<boolean> {
  return await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksDare.updateMany({
      where: {
        id: dare.id,
        dareState: "pending_accept",
        acceptDeadline: { lt: now },
      },
      data: {
        dareState: "expired",
        settledAt: now,
        ...pendingDareCalloutRefresh(),
      },
    });
    if (claim.count !== 1) return false;
    const revision = await tx.bucksDareRevision.findUniqueOrThrow({
      where: {
        dareId_revision: {
          dareId: dare.id,
          revision: dare.fundedRevision ?? dare.currentRevision,
        },
      },
    });
    const facts = await dareMoneyFactsInTransaction(tx, {
      dareId: dare.id,
      serverId: dare.serverId,
      targetAliases: dare.targets.map((target) => target.alias),
      conditionSummary: revision.plainLanguage,
    });
    await refundDareContributionsInTransaction(tx, {
      facts,
      resolution: "expired",
      withCut: false,
    });
    await enqueueDareNotificationInTransaction(tx, {
      dareId: dare.id,
      revision: dare.fundedRevision ?? dare.currentRevision,
      category: "lifecycle",
      kind: "expired",
      summary: `The acceptance window expired; ${facts.potTotal.toString()} Bryan Bucks were fully refunded.`,
      deduplicationKey: `dare:${dare.id.toString()}:revision:${(dare.fundedRevision ?? dare.currentRevision).toString()}:expired`,
      occurredAt: now,
    });
    return true;
  });
}

export async function expireDareAcceptWindows(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<number[]> {
  const rows = await prismaClient.bucksDare.findMany({
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

export async function settleEndedDareWindows(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareSettlementSummary[]> {
  const cutoff = new Date(now.getTime() - DARE_WINDOW_INGESTION_GRACE_MS);
  const rows = await prismaClient.bucksDare.findMany({
    where: { dareState: "active", deadlineAt: { lt: cutoff } },
    include: { targets: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const batch = await collectDareBatch(
    rows,
    async (row): Promise<DareSettlementSummary | undefined> => {
      if (hasReadableContract(row.contractJson)) {
        return await settleActiveDareAtBound(row, prismaClient, now);
      }
      const voided = await voidDareWithFullRefund(
        row,
        "invalid_contract",
        prismaClient,
        { now },
      );
      return voided
        ? {
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
      logger.error(`Failed to settle ended Dare ${row.id.toString()}:`, error);
    },
  );
  const summaries = batch.values.filter((summary) => summary !== undefined);
  if (batch.firstFailure !== null) {
    throw new DarePartialSettlementError(summaries, batch.firstFailure.error);
  }
  return summaries;
}
