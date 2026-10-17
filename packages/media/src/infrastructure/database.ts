import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma/client.ts";

export function createDatabase(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export type Database = ReturnType<typeof createDatabase>;
