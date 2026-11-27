import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "#generated/prisma/client.ts";

export function createDatabase(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
export type Database = ReturnType<typeof createDatabase>;
export type Tx = Prisma.TransactionClient;

/** Runs `work` in one transaction with generous bounds for large manifests. */
export function transact<T>(
  database: Database,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return database.$transaction(work, { timeout: 30_000, maxWait: 30_000 });
}
