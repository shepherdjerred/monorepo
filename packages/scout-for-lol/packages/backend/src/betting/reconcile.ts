import * as Sentry from "@sentry/bun";
import { auditBucksMatchedPools } from "#src/betting/reconcile-pools.ts";
import { auditBucksPositions } from "#src/betting/reconcile-positions.ts";
import {
  auditFinding,
  type BucksAuditFinding,
} from "#src/betting/reconcile-shared.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { Db } from "#src/lib/audit/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-reconcile");

export const BUCKS_RECONCILIATION_CRON = {
  schedule: "0 0 5 * * *",
  jobName: "bryan_bucks_reconciliation",
  logMessage: "🧾 Reconciling Bryan Bucks accounting",
  timezone: "UTC",
  runOnInit: true,
} as const;

async function auditAccountBalances(
  prismaClient: Db,
  findings: BucksAuditFinding[],
): Promise<number> {
  const accounts = await prismaClient.bucksAccount.findMany({
    select: {
      id: true,
      balance: true,
      ledgerEntries: {
        orderBy: { id: "asc" },
        select: { id: true, delta: true, balanceAfter: true },
      },
    },
  });
  for (const account of accounts) {
    let runningBalance = 0;
    for (const entry of account.ledgerEntries) {
      runningBalance += entry.delta;
      if (entry.balanceAfter !== runningBalance) {
        findings.push(
          auditFinding(
            "running_balance",
            `Ledger entry ${entry.id.toString()} records ${entry.balanceAfter.toString()} after a derived balance of ${runningBalance.toString()}`,
            { bucksAccountId: account.id },
          ),
        );
      }
    }
    if (runningBalance !== account.balance) {
      findings.push(
        auditFinding(
          "balance_sum",
          `Stored balance ${account.balance.toString()} differs from ledger sum ${runningBalance.toString()}`,
          { bucksAccountId: account.id },
        ),
      );
    }
  }
  return accounts.length;
}

function reportAuditResult(
  findings: readonly BucksAuditFinding[],
  accountCount: number,
): void {
  if (findings.length === 0) {
    logger.info(
      `✅ Reconciled ${accountCount.toString()} Bryan Bucks account(s) with no findings`,
    );
    return;
  }
  logger.error(
    `🚨 Bryan Bucks reconciliation found ${findings.length.toString()} accounting issue(s)`,
  );
  Sentry.captureMessage("Bryan Bucks reconciliation failed", {
    level: "error",
    tags: { source: "betting-reconcile" },
    extra: {
      findingCount: findings.length,
      findingKinds: [...new Set(findings.map((item) => item.kind))],
      findings,
    },
  });
}

/**
 * Re-derive the economy from its append-only ledger and matching records.
 * Findings are reported, never repaired: an automatic rewrite would erase the
 * evidence needed to diagnose the broken transaction.
 */
export async function reconcileBucksBalances(
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<BucksAuditFinding[]> {
  try {
    const audit = await prismaClient.$transaction(async (tx) => {
      // Every invariant is derived from one SQLite read snapshot. Without the
      // shared transaction, a valid placement or settlement could commit
      // between related-table queries and create a false discrepancy alert.
      const findings: BucksAuditFinding[] = [];
      const accountCount = await auditAccountBalances(tx, findings);
      await auditBucksPositions(tx, findings);
      await auditBucksMatchedPools(tx, findings);
      return { findings, accountCount };
    });
    reportAuditResult(audit.findings, audit.accountCount);
    return audit.findings;
  } catch (error) {
    logger.error("❌ Could not reconcile Bryan Bucks accounting:", error);
    Sentry.captureException(error, { tags: { source: "betting-reconcile" } });
    return [
      auditFinding(
        "settlement",
        "Reconciliation query failed before completion",
      ),
    ];
  }
}
