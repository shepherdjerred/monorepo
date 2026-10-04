import * as Sentry from "@sentry/bun";
import type { DareContract, RawMatch } from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import { collectDareBatch } from "#src/betting/dares/settlement/dare-settle-batch.ts";
import {
  DarePartialSettlementError,
  type DareSettlementSummary,
} from "#src/betting/dares/settlement/dare-settle-types.ts";
import { settleDareOrVoidOnStorageOverflow } from "#src/betting/dares/settlement/dare-settle-overflow.ts";
import {
  captureDareSqlForMatch,
  settleDareSqlAtDeadline,
} from "#src/betting/dares/settlement/dare-settle-contract.ts";
import {
  matchTouchesRelationalDare,
  relationalDareMatchContext,
} from "#src/betting/dares/evaluation/dare-match-eligibility.ts";
import {
  parseRelationalDareContract,
  readableRelationalDareContract,
} from "#src/betting/dares/dare-common.ts";
import { voidDareWithFullRefund } from "#src/betting/dares/settlement/dare-void.ts";
import type { DareNotificationDisposition } from "#src/betting/dares/presentation/notify/dare-notification-outbox.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-settle");

type ActiveDareRow = Prisma.BucksDareGetPayload<{
  include: { targets: true };
}>;

function reportDareBatchFailure(
  stage: "inspect" | "settle",
  dare: { id: number },
  matchId: string,
  error: unknown,
): void {
  logger.error(
    `Could not ${stage} Dare ${dare.id.toString()} for ${matchId}:`,
    error,
  );
  Sentry.captureException(error, {
    tags: {
      source: `betting-dare-${stage}`,
      matchId,
      dareId: dare.id.toString(),
    },
  });
}

async function inspectStoredContract(
  row: ActiveDareRow,
  prismaClient: ExtendedPrismaClient,
  options: {
    now: Date;
    matchId: string;
    notify: DareNotificationDisposition;
  },
): Promise<
  | { kind: "valid"; contract: DareContract }
  | { kind: "invalid"; summary: DareSettlementSummary | null }
> {
  const contract = readableRelationalDareContract(row.contractJson);
  if (contract !== null) return { kind: "valid", contract };
  const voided = await voidDareWithFullRefund(
    row,
    "invalid_contract",
    prismaClient,
    options,
  );
  return {
    kind: "invalid",
    summary: voided
      ? {
          dareId: row.id,
          serverId: row.serverId,
          channelId: row.channelId,
          resolution: "voided",
          value: null,
          finality: { value: null, final: true, reason: "contract_error" },
          proof: null,
        }
      : null,
  };
}

export async function settleDaresForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
  options: {
    now?: Date | undefined;
    /** See `SettlementAnnouncementSink.mayEnqueueDareNotification`. */
    notify?: DareNotificationDisposition | undefined;
  } = {},
): Promise<DareSettlementSummary[]> {
  const now = options.now ?? new Date();
  const notify = options.notify ?? "enqueue";
  const context = relationalDareMatchContext(matchData);
  if (context === null) return [];
  const rows = await prismaClient.bucksDare.findMany({
    where: {
      dareState: "active",
      activatedAt: { lt: context.gameStartAt },
      deadlineAt: { gte: context.gameEndAt },
    },
    include: { targets: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const summaries: DareSettlementSummary[] = [];
  const contracts: {
    row: ActiveDareRow;
    contract: DareContract;
  }[] = [];
  const inspected = await collectDareBatch(
    rows,
    async (row) => ({
      row,
      outcome: await inspectStoredContract(row, prismaClient, {
        now,
        matchId: matchData.metadata.matchId,
        notify,
      }),
    }),
    (row, error) => {
      reportDareBatchFailure("inspect", row, matchData.metadata.matchId, error);
    },
  );
  for (const result of inspected.values) {
    if (result.outcome.kind === "valid") {
      contracts.push({ row: result.row, contract: result.outcome.contract });
    } else if (result.outcome.summary !== null) {
      summaries.push(result.outcome.summary);
    }
  }
  const relevant = contracts.filter(({ contract }) =>
    matchTouchesRelationalDare(matchData, contract),
  );
  if (relevant.length === 0) {
    if (inspected.firstFailure !== null) {
      throw new DarePartialSettlementError(
        summaries,
        inspected.firstFailure.error,
      );
    }
    return summaries;
  }
  const captured = await collectDareBatch(
    relevant,
    async ({ row, contract }) =>
      await settleDareOrVoidOnStorageOverflow(
        {
          dare: row,
          prismaClient,
          now,
          matchId: matchData.metadata.matchId,
          notify,
        },
        async () =>
          await captureDareSqlForMatch({
            dare: row,
            contract,
            matchData,
            prismaClient,
            now,
            notify,
          }),
      ),
    ({ row }, error) => {
      reportDareBatchFailure("settle", row, matchData.metadata.matchId, error);
    },
  );
  for (const summary of captured.values) {
    if (summary !== undefined) summaries.push(summary);
  }
  const firstFailure = inspected.firstFailure ?? captured.firstFailure;
  if (firstFailure !== null) {
    throw new DarePartialSettlementError(summaries, firstFailure.error);
  }
  return summaries;
}

export async function settleActiveDareAtBound(
  dare: ActiveDareRow,
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareSettlementSummary | undefined> {
  if (dare.contractJson === null) {
    throw new Error(`Active Dare ${dare.id.toString()} has no contract.`);
  }
  const contract = parseRelationalDareContract(dare.contractJson);
  return await settleDareOrVoidOnStorageOverflow(
    // A deadline bound delivers no match, so nothing here is owed silence.
    { dare, prismaClient, now, notify: "enqueue" },
    async () =>
      await settleDareSqlAtDeadline(dare, contract, prismaClient, now),
  );
}

/**
 * Every Dare a match's settlement made terminal, read from the Dares
 * themselves.
 *
 * Settlement returns a summary only for the transition that committed it, so
 * an attempt that resumes after an earlier one resolved a Dare gets nothing
 * back for it. The settling transaction stamps `settledMatchId`, which is what
 * lets the receipt still name that Dare.
 */
export async function listDareIdsSettledByMatch(
  matchId: string,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<number[]> {
  const rows = await prismaClient.bucksDare.findMany({
    where: { settledMatchId: matchId },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.id);
}
