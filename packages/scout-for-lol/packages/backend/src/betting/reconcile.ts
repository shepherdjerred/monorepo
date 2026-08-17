import * as Sentry from "@sentry/bun";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-reconcile");

/**
 * Check every stored balance against the ledger that explains it.
 *
 * `BucksAccount.balance` is stored rather than derived, for reasons documented
 * on the model — but "stored" must not mean "trusted". The ledger is the
 * source of truth, so this re-derives from it and *reports* disagreement rather
 * than silently correcting it: a drift means a bug in the one module allowed to
 * move balances, and quietly patching the number would hide it.
 *
 * This is the "validate against an independent oracle" rule applied to
 * ourselves — the replacement (the column) is checked against the thing it
 * replaces (the sum), never the other way around.
 */

export type BalanceDrift = {
  bucksAccountId: number;
  serverId: string;
  discordId: string;
  isHouse: boolean;
  storedBalance: number;
  ledgerSum: number;
};

export async function reconcileBucksBalances(
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<BalanceDrift[]> {
  const drifts: BalanceDrift[] = [];

  try {
    const accounts = await prismaClient.bucksAccount.findMany({
      select: {
        id: true,
        serverId: true,
        discordId: true,
        isHouse: true,
        balance: true,
      },
    });

    for (const account of accounts) {
      const aggregate = await prismaClient.bucksLedgerEntry.aggregate({
        where: { bucksAccountId: account.id },
        _sum: { delta: true },
      });
      const ledgerSum = aggregate._sum.delta ?? 0;

      if (ledgerSum !== account.balance) {
        drifts.push({
          bucksAccountId: account.id,
          serverId: account.serverId,
          discordId: account.discordId,
          isHouse: account.isHouse,
          storedBalance: account.balance,
          ledgerSum,
        });
      }
    }

    if (drifts.length > 0) {
      logger.error(
        `🚨 ${drifts.length.toString()} Bryan Bucks balance(s) disagree with their ledger`,
      );
      Sentry.captureMessage("Bryan Bucks balance drift detected", {
        level: "error",
        tags: { source: "betting-reconcile" },
        extra: { driftCount: drifts.length },
      });
    } else {
      logger.info(
        `✅ All ${accounts.length.toString()} Bryan Bucks balance(s) match their ledger`,
      );
    }
  } catch (error) {
    logger.error("❌ Could not reconcile Bryan Bucks balances:", error);
    Sentry.captureException(error, { tags: { source: "betting-reconcile" } });
  }

  return drifts;
}
