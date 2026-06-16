import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// Singleton pattern for Prisma client using a well-known key (birmel pattern).
// `createPrisma()` is called per `/play` session, so this MUST cache in production
// too — otherwise every `/play`->`/stop` cycle would leak a libSQL engine connection
// (PR #1251 P1 fix). The hot-reload (`bun --watch`) benefit is the secondary motivator.
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
  // Always cache. Production calls this per `/play`; without caching it leaks a
  // libSQL engine connection per session. Dev/hot-reload also benefits because
  // `globalThis` survives module re-evals.
  setGlobalPrisma(client);
  return client;
}

/** Disconnect the cached Prisma client (if any) and clear the cache. */
export async function disconnectPrisma(): Promise<void> {
  const existing = getGlobalPrisma();
  if (existing === undefined) return;
  await existing.$disconnect();
  if (PRISMA_KEY in globalThis) {
    Reflect.deleteProperty(globalThis, PRISMA_KEY);
  }
}
