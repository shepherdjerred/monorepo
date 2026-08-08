import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";

import { PrismaClient } from "#generated/prisma/client/index.js";

const DatabaseUrlSchema = z.url().startsWith("postgresql://");
const databaseUrl = DatabaseUrlSchema.parse(Bun.env["DATABASE_URL"]);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

let lastFailure: unknown = new Error("Database readiness was not attempted");
try {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.warn(`PostgreSQL ready after ${String(attempt)} attempt(s)`);
      lastFailure = undefined;
      break;
    } catch (error) {
      lastFailure = error;
      await Bun.sleep(1000);
    }
  }
  if (lastFailure !== undefined)
    throw new Error("PostgreSQL did not become ready within 30 seconds", {
      cause: lastFailure,
    });
} finally {
  await prisma.$disconnect();
}
