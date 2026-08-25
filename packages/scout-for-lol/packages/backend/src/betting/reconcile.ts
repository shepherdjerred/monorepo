import * as Sentry from "@sentry/bun";
import { Prisma } from "#generated/prisma/client/index.js";
import { auditBucksMatchedPools } from "#src/betting/reconcile-pools.ts";
import { auditBucksPositions } from "#src/betting/reconcile-positions.ts";
import {
  BUCKS_RECONCILIATION_PAGE_SIZE,
  BucksAuditCollector,
  auditFinding,
  type BucksAuditFinding,
  type BucksAuditSink,
} from "#src/betting/reconcile-shared.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingReconciliationFindings,
  bettingReconciliationLastRunTimestampSeconds,
  bettingReconciliationRunsTotal,
} from "#src/metrics/betting.ts";

const logger = createLogger("betting-reconcile");

export const BUCKS_RECONCILIATION_CRON = {
  schedule: "0 0 5 * * *",
  jobName: "bryan_bucks_reconciliation",
  logMessage: "🧾 Reconciling Bryan Bucks accounting",
  timezone: "UTC",
  runOnInit: true,
} as const;

/** Full-history audits intentionally share one read snapshot. Give that
 * bounded, paged scan enough time to outlive Prisma's five-second default. */
export const BUCKS_RECONCILIATION_TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;

async function auditAccountBalances(
  prismaClient: Db,
  findings: BucksAuditSink,
): Promise<number> {
  let accountCount = 0;
  let afterAccountId = 0;
  let hasMoreAccounts = true;
  while (hasMoreAccounts) {
    const accounts = await prismaClient.bucksAccount.findMany({
      where: { id: { gt: afterAccountId } },
      orderBy: { id: "asc" },
      take: BUCKS_RECONCILIATION_PAGE_SIZE,
      select: { id: true, balance: true },
    });
    for (const account of accounts) {
      accountCount += 1;
      const runningBalance = await auditAccountLedger(
        prismaClient,
        account.id,
        findings,
      );
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
    const lastAccount = accounts.at(-1);
    hasMoreAccounts = lastAccount !== undefined;
    if (lastAccount !== undefined) {
      afterAccountId = lastAccount.id;
    }
  }
  return accountCount;
}

async function auditAccountLedger(
  prismaClient: Db,
  bucksAccountId: number,
  findings: BucksAuditSink,
): Promise<number> {
  let runningBalance = 0;
  let afterLedgerId = 0;
  let hasMoreEntries = true;
  while (hasMoreEntries) {
    const entries = await prismaClient.bucksLedgerEntry.findMany({
      where: { bucksAccountId, id: { gt: afterLedgerId } },
      orderBy: { id: "asc" },
      take: BUCKS_RECONCILIATION_PAGE_SIZE,
      select: { id: true, delta: true, balanceAfter: true },
    });
    for (const entry of entries) {
      runningBalance += entry.delta;
      if (entry.balanceAfter !== runningBalance) {
        findings.push(
          auditFinding(
            "running_balance",
            `Ledger entry ${entry.id.toString()} records ${entry.balanceAfter.toString()} after a derived balance of ${runningBalance.toString()}`,
            { bucksAccountId },
          ),
        );
      }
    }
    const lastEntry = entries.at(-1);
    hasMoreEntries = lastEntry !== undefined;
    if (lastEntry !== undefined) {
      afterLedgerId = lastEntry.id;
    }
  }
  return runningBalance;
}

function reportAuditResult(
  findings: BucksAuditCollector,
  accountCount: number,
): void {
  // Reset per run: a gauge answers "is the ledger drifting right now"
  // directly, where a nightly counter's increase() alert would be noisy.
  bettingReconciliationFindings.reset();
  bettingReconciliationLastRunTimestampSeconds.set(Date.now() / 1000);
  for (const kind of findings.findingKinds) {
    bettingReconciliationFindings.set({ kind }, 1);
  }
  if (findings.totalCount === 0) {
    bettingReconciliationRunsTotal.inc({ status: "clean" });
    logger.info(
      `✅ Reconciled ${accountCount.toString()} Bryan Bucks account(s) with no findings`,
    );
    return;
  }
  bettingReconciliationRunsTotal.inc({ status: "findings" });
  logger.error(
    `🚨 Bryan Bucks reconciliation found ${findings.totalCount.toString()} accounting issue(s)`,
  );
  Sentry.captureMessage("Bryan Bucks reconciliation failed", {
    level: "error",
    tags: { source: "betting-reconcile" },
    extra: {
      findingCount: findings.totalCount,
      findingKinds: findings.findingKinds,
      retainedFindingCount: findings.retained.length,
      truncatedFindingCount: findings.totalCount - findings.retained.length,
      findings: findings.retained,
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
    const audit = await prismaClient.$transaction(
      async (tx) => {
        // Every invariant is derived from one PostgreSQL repeatable-read
        // snapshot. Without the
        // shared transaction, a valid placement or settlement could commit
        // between related-table queries and create a false discrepancy alert.
        const findings = new BucksAuditCollector();
        const accountCount = await auditAccountBalances(tx, findings);
        await auditBucksPositions(tx, findings);
        await auditBucksMatchedPools(tx, findings);
        return { findings, accountCount };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: BUCKS_RECONCILIATION_TRANSACTION_TIMEOUT_MS,
      },
    );
    reportAuditResult(audit.findings, audit.accountCount);
    return [...audit.findings.retained];
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
