#!/usr/bin/env bun
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma/client/index.js";
import { assertDatabasePrepared } from "#src/database/startup-readiness.ts";

const databaseUrl = Bun.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl === "") {
  throw new Error("DATABASE_URL is required");
}
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});
try {
  await assertDatabasePrepared(prisma);
  console.log("Database prepared: ledger verified");
} finally {
  await prisma.$disconnect();
}
