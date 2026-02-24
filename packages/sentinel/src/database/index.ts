import { PrismaClient } from "@prisma/client";

const PRISMA_KEY = "__sentinel_prisma__";

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

export function getPrisma(): PrismaClient {
  const existing = getGlobalPrisma();
  if (existing != null) {
    return existing;
  }

  const client = new PrismaClient({
    log:
      Bun.env["LOG_LEVEL"] === "debug"
        ? ["query", "info", "warn", "error"]
        : ["error"],
  });

  setGlobalPrisma(client);
  return client;
}

export async function initDatabase(): Promise<void> {
  const prisma = getPrisma();
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
}

export async function disconnectPrisma(): Promise<void> {
  const prisma = getGlobalPrisma();
  if (prisma != null) {
    await prisma.$disconnect();
  }
}
