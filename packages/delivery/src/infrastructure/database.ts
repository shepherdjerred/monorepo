import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma/client.ts";

export function createDatabase(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  });
}
export type Database = ReturnType<typeof createDatabase>;
