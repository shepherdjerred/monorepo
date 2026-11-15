import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma/client.ts";

export function createDatabase(connectionString?: string): PrismaClient {
  const url =
    connectionString ??
    Bun.env["DATABASE_URL"] ??
    "postgres://postgres:postgres@127.0.0.1:5432/tasknotes";
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

let databaseInstance: PrismaClient | null = null;

export function getDatabase(): PrismaClient {
  databaseInstance ??= createDatabase();
  return databaseInstance;
}
