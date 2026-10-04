import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
  assertDatabasePrepared,
  verifyLedgerBalances,
} from "#src/database/startup-readiness.ts";
import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";

const GUILD = DiscordGuildIdSchema.parse("123456789012345678");
const USER = DiscordAccountIdSchema.parse("234567890123456789");

const {
  prisma: cleanupClient,
  dbPath,
  dbUrl,
} = createTestDatabase("startup-readiness");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: dbUrl }),
});
afterAll(async () => {
  await prisma.$disconnect();
  await dropTestDatabase(cleanupClient, dbPath);
});
beforeEach(async () => {
  await prisma.bucksLedgerEntry.deleteMany();
  await prisma.bucksAccount.deleteMany();
});

describe("SQL-only database startup", () => {
  test("a freshly migrated database boots with no import step", async () => {
    await assertDatabasePrepared(prisma);
    await assertDatabasePrepared(prisma);
  });
  test("refuses ledger drift", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "BucksAccount" ("serverId", "discordId", "analyticsUserId", balance, "createdAt", "updatedAt") VALUES ('123456789012345678', '234567890123456789', 'startup-readiness-test', 1, now(), now())`,
    );
    try {
      await expect(assertDatabasePrepared(prisma)).rejects.toThrow(
        "Ledger drift",
      );
    } finally {
      await prisma.bucksAccount.deleteMany();
    }
  });
  test("compares a balanced account and ledger in one SQL snapshot", async () => {
    const account = await prisma.bucksAccount.create({
      data: {
        serverId: GUILD,
        discordId: USER,
        balance: 25,
      },
    });
    await prisma.bucksLedgerEntry.create({
      data: {
        bucksAccountId: account.id,
        delta: 25,
        balanceAfter: 25,
        kind: "seed",
        context: "{}",
      },
    });
    const query = vi.spyOn(prisma, "$queryRawUnsafe");
    try {
      expect(await verifyLedgerBalances(prisma)).toEqual([]);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]?.[0]).toContain('FROM "BucksAccount"');
      expect(query.mock.calls[0]?.[0]).toContain('FROM "BucksLedgerEntry"');
    } finally {
      query.mockRestore();
      await prisma.bucksAccount.deleteMany();
    }
  });
});
