import { AsyncMutex } from "#infrastructure/async-mutex";
import { createPrismaClient } from "#infrastructure/prisma-client";
import { PrismaOpsRepository } from "#infrastructure/prisma-ops-repository";
import { PrismaAlertLedgerRepository } from "#infrastructure/prisma-repository";
import { PrismaReportRepository } from "#infrastructure/reports/prisma-report-repository";

/** All repositories over one SQLite client and one write lock. */
export async function createPrismaRepositories(databaseUrl: string): Promise<{
  ledger: PrismaAlertLedgerRepository;
  ops: PrismaOpsRepository;
  reports: PrismaReportRepository;
}> {
  const prisma = await createPrismaClient(databaseUrl);
  const writeMutex = new AsyncMutex();
  return {
    ledger: new PrismaAlertLedgerRepository(prisma, writeMutex),
    ops: new PrismaOpsRepository(prisma, writeMutex),
    reports: new PrismaReportRepository(prisma, writeMutex),
  };
}
