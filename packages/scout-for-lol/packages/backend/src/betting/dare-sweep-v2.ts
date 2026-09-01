import type { Prisma } from "#generated/prisma/client/index.js";
import { DareContractV2Schema } from "@scout-for-lol/data";
import { DARE_WINDOW_INGESTION_GRACE_MS } from "#src/betting/constants.ts";
import {
  dareV2MoneyFactsInTransaction,
  refundDareV2ContributionsInTransaction,
} from "#src/betting/dare-ledger-v2.ts";
import { settleActiveDareV2AtBound } from "#src/betting/dare-settle-v2.ts";
import type { DareV2SettlementSummary } from "#src/betting/dare-settle-types-v2.ts";
import { voidDareV2WithFullRefund } from "#src/betting/dare-void-v2.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

type PendingDareV2 = Prisma.BucksDareV2GetPayload<{
  include: { targets: true };
}>;

function hasReadableContract(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    return DareContractV2Schema.safeParse(JSON.parse(raw)).success;
  } catch {
    return false;
  }
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
      data: { dareState: "expired", settledAt: now },
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
  const summaries: DareV2SettlementSummary[] = [];
  for (const row of rows) {
    if (!hasReadableContract(row.contractJson)) {
      const voided = await voidDareV2WithFullRefund(
        row,
        "invalid_contract",
        prismaClient,
        now,
      );
      if (voided) {
        summaries.push({
          contractVersion: 2,
          dareId: row.id,
          serverId: row.serverId,
          channelId: row.channelId,
          resolution: "voided",
          value: null,
          finality: { value: null, final: true, reason: "contract_error" },
          proof: null,
        });
      }
      continue;
    }
    const summary = await settleActiveDareV2AtBound(row, prismaClient, now);
    if (summary !== undefined) summaries.push(summary);
  }
  return summaries;
}
