import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// Singleton pattern for Prisma client using a well-known key
const PRISMA_KEY = "__birmel_prisma__";

function getGlobalPrisma(): PrismaClient | undefined {
  if (PRISMA_KEY in globalThis) {
    const value: unknown = Object.getOwnPropertyDescriptor(
      globalThis,
      PRISMA_KEY,
    )?.value;
    if (value instanceof PrismaClient) {
      return value;
    }
  }
  return undefined;
}

function setGlobalPrisma(client: PrismaClient): void {
  Object.defineProperty(globalThis, PRISMA_KEY, {
    value: client,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

const databasePath = Bun.env["DATABASE_PATH"];
let databaseUrl = Bun.env["DATABASE_URL"];
if (databasePath != null && databasePath.length > 0) {
  databaseUrl = databasePath.startsWith("file:")
    ? databasePath
    : `file:${databasePath}`;
}

const adapter = new PrismaLibSql({
  url: databaseUrl ?? "file:./data/birmel.db",
});

export const prisma =
  getGlobalPrisma() ??
  new PrismaClient({
    adapter,
    log:
      Bun.env["LOG_LEVEL"] === "debug"
        ? ["query", "info", "warn", "error"]
        : ["error"],
  });

if (Bun.env.NODE_ENV !== "production") {
  setGlobalPrisma(prisma);
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
