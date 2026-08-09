import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// Singleton pattern for Prisma client using a well-known key, so a reload in
// watch mode does not leak a second pool. Mirrors the birmel pattern.
const PRISMA_KEY = "__starlight_karma_prisma__";

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

/**
 * Resolve the SQLite file URL from the environment.
 *
 * `DATABASE_URL` wins; `DATABASE_PATH` is accepted as a bare path for parity
 * with the deployment, which sets `DATABASE_PATH=/data/karma.db`.
 */
export function databaseUrlFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  const url = environment["DATABASE_URL"];
  if (url != null && url.length > 0) {
    return url;
  }
  const path = environment["DATABASE_PATH"] ?? "./data/karma.db";
  return path.startsWith("file:") ? path : `file:${path}`;
}

const adapter = new PrismaLibSql({ url: databaseUrlFromEnvironment() });

export const prisma =
  getGlobalPrisma() ??
  new PrismaClient({
    adapter,
    log:
      Bun.env["LOG_LEVEL"] === "debug" ? ["query", "warn", "error"] : ["error"],
  });

if (Bun.env.NODE_ENV !== "production") {
  setGlobalPrisma(prisma);
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
