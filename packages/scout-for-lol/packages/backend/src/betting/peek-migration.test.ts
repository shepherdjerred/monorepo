import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { z } from "zod";

const BackfilledPoolSchema = z.object({
  matchId: z.string(),
  peekAvailableAt: z.number(),
});

describe("Bryan Bucks peek migration", () => {
  test("backfills terminal pools from detection and active pools conservatively", async () => {
    const database = new Database(":memory:");
    try {
      database.run(`
        CREATE TABLE "BucksAccount" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "serverId" TEXT NOT NULL,
          "discordId" TEXT NOT NULL
        );
        CREATE TABLE "BucksMatchPool" (
          "matchId" TEXT NOT NULL,
          "serverId" TEXT NOT NULL,
          "detectedAt" DATETIME NOT NULL,
          "closesAt" DATETIME NOT NULL,
          "poolState" TEXT NOT NULL,
          "settledAt" DATETIME
        );
        INSERT INTO "BucksMatchPool"
          ("matchId", "serverId", "detectedAt", "closesAt", "poolState", "settledAt")
        VALUES
          ('active-countdown', 'guild', 1000, 601000, 'open', NULL),
          ('active-short-window', 'guild', 2000, 50000, 'closed', NULL),
          ('historical', 'guild', 3000, 603000, 'settled', 700000);
      `);

      const migrationPath = `${import.meta.dir}/../../prisma/migrations/20260819000000_bryan_bucks_peek_pass/migration.sql`;
      database.run(await Bun.file(migrationPath).text());

      const pools = z
        .array(BackfilledPoolSchema)
        .parse(
          database
            .query(
              `SELECT "matchId", "peekAvailableAt" FROM "BucksMatchPool" ORDER BY "matchId"`,
            )
            .all(),
        );
      expect(pools).toEqual([
        { matchId: "active-countdown", peekAvailableAt: 601_000 },
        { matchId: "active-short-window", peekAvailableAt: 122_000 },
        { matchId: "historical", peekAvailableAt: 123_000 },
      ]);
    } finally {
      database.close();
    }
  });
});
