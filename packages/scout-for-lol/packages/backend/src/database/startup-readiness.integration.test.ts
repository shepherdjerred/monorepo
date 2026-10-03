import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
  assertDatabasePrepared,
  verifyLedgerBalances,
} from "#src/database/startup-readiness.ts";
import { runImport } from "#src/database/legacy-import/run-import.ts";
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
  await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS _legacy_sqlite_import");
});

async function prepareFresh(): Promise<void> {
  await runImport({
    prisma,
    sqlitePath: `/tmp/scout-nonexistent-${dbPath}.sqlite`,
    allowFreshInstall: true,
  });
}

describe("SQL-only database startup", () => {
  test("refuses an unprepared database", async () => {
    await expect(assertDatabasePrepared(prisma)).rejects.toThrow(
      "not prepared",
    );
  });
  test("explicit fresh preparation permits repeated startup without SQLite", async () => {
    await prepareFresh();
    await assertDatabasePrepared(prisma);
    await assertDatabasePrepared(prisma);
  });
  test("an imported database needs its receipt, not its retained source", async () => {
    await prepareFresh();
    await prisma.$executeRawUnsafe(
      "UPDATE _legacy_sqlite_import SET source = '/missing/retained.sqlite', source_size_bytes = 1024, source_digest = $1, row_counts = '{\"Player\": 4}'::jsonb",
      "a".repeat(64),
    );
    await assertDatabasePrepared(prisma);
  });
  test.each([
    "DELETE FROM _legacy_sqlite_import",
    "UPDATE _legacy_sqlite_import SET source_digest = 'corrupt'",
    "UPDATE _legacy_sqlite_import SET source = '/missing/source.sqlite'",
    "UPDATE _legacy_sqlite_import SET row_counts = '{\"Player\": -1}'::jsonb",
    "UPDATE _legacy_sqlite_import SET source_size_bytes = NULL",
  ])("refuses incomplete or malformed receipt: %s", async (sql) => {
    await prepareFresh();
    await prisma.$executeRawUnsafe(sql);
    await expect(assertDatabasePrepared(prisma)).rejects.toThrow(
      "valid completed",
    );
  });
  test("refuses ledger drift", async () => {
    await prepareFresh();
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
