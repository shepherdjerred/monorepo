import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// Singleton pattern for Prisma client using a well-known key (birmel pattern):
// hot-reload (`bun --watch`) re-evaluates modules but keeps globalThis, so the
// libSQL connection is reused instead of leaking one per reload.
const PRISMA_KEY = "__dpmk_prisma__";

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

export function databaseUrl(configDbPath: string): string {
  const fromPath = Bun.env.DATABASE_PATH;
  const fromUrl = Bun.env.DATABASE_URL;
  if (fromUrl != null && fromUrl.length > 0) return fromUrl;
  const path =
    fromPath != null && fromPath.length > 0 ? fromPath : configDbPath;
  return path.startsWith("file:") ? path : `file:${path}`;
}

export function createPrisma(url: string): PrismaClient {
  const existing = getGlobalPrisma();
  if (existing !== undefined) return existing;
  const adapter = new PrismaLibSql({ url });
  const client = new PrismaClient({
    adapter,
    log:
      Bun.env.LOG_LEVEL === "debug"
        ? ["query", "info", "warn", "error"]
        : ["error"],
  });
  if (Bun.env.NODE_ENV !== "production") {
    setGlobalPrisma(client);
  }
  return client;
}
