import { AsyncMutex } from "#infrastructure/async-mutex";
import { PrismaOpsRepository } from "#infrastructure/prisma-ops-repository";
import {
  createPrismaClient,
  PrismaAlertLedgerRepository,
} from "#infrastructure/prisma-repository";

/** Both repositories over one SQLite client and one write lock. */
export async function createPrismaRepositories(databaseUrl: string): Promise<{
  ledger: PrismaAlertLedgerRepository;
  ops: PrismaOpsRepository;
}> {
  const prisma = await createPrismaClient(databaseUrl);
  const writeMutex = new AsyncMutex();
  return {
    ledger: new PrismaAlertLedgerRepository(prisma, writeMutex),
    ops: new PrismaOpsRepository(prisma, writeMutex),
  };
}
