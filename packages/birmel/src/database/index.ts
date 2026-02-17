import { PrismaClient } from "@prisma/client";

// Singleton pattern for Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const databasePath = process.env["DATABASE_PATH"];
const datasourceUrl = databasePath != null && databasePath.length > 0
  ? (databasePath.startsWith("file:")
    ? databasePath
    : `file:${databasePath}`)
  : undefined;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl != null && datasourceUrl.length > 0 ? { datasourceUrl } : {}),
    log:
      process.env["LOG_LEVEL"] === "debug"
        ? ["query", "info", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
