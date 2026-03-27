import { PrismaClient } from "@prisma/client";

const PRISMA_KEY = "__scout_status_prisma__";

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

export const prisma = getGlobalPrisma() ?? new PrismaClient();

setGlobalPrisma(prisma);
