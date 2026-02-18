import { PrismaClient } from "@prisma/client";

// Singleton pattern for Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const databasePath = Bun.env["DATABASE_PATH"];
let datasourceUrl: string | undefined;
if (databasePath != null && databasePath.length > 0) {
  datasourceUrl = databasePath.startsWith("file:")
    ? databasePath
    : `file:${databasePath}`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl != null && datasourceUrl.length > 0
      ? { datasourceUrl }
      : {}),
    log:
      Bun.env["LOG_LEVEL"] === "debug"
        ? ["query", "info", "warn", "error"]
        : ["error"],
  });

if (Bun.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
