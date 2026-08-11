import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { z } from "zod";

const database = new Database(":memory:");

function runSqlScript(sql: string): void {
  for (const statement of sql.split(";")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      database.run(trimmed);
    }
  }
}

beforeAll(async () => {
  runSqlScript(`
    CREATE TABLE "GuildInstall" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "serverId" TEXT NOT NULL,
      "serverName" TEXT NOT NULL,
      "ownerDiscordId" TEXT NOT NULL,
      "addedByDiscordId" TEXT NOT NULL,
      "memberCount" INTEGER NOT NULL,
      "installedAt" DATETIME NOT NULL,
      "outreach3dSentAt" DATETIME,
      "outreach14dSentAt" DATETIME,
      "outreach30dSentAt" DATETIME,
      "emailNudgeSentAt" DATETIME,
      "removedAt" DATETIME
    );
    CREATE UNIQUE INDEX "GuildInstall_serverId_key" ON "GuildInstall"("serverId");
    CREATE INDEX "GuildInstall_installedAt_idx" ON "GuildInstall"("installedAt");
    INSERT INTO "GuildInstall" (
      "serverId", "serverName", "ownerDiscordId", "addedByDiscordId",
      "memberCount", "installedAt", "removedAt"
    ) VALUES
      ('guild-one', 'One', 'owner-one', 'owner-one', 5, '2026-01-01', NULL),
      ('guild-two', 'Two', 'owner-two', 'owner-two', 500, '2026-02-01', '2026-03-01');
  `);

  const migrationUrl = new URL(
    "../../prisma/migrations/20260809010000_guild_install_product_analytics/migration.sql",
    import.meta.url,
  );
  runSqlScript(await Bun.file(migrationUrl).text());
});

afterAll(() => {
  database.close();
});

describe("GuildInstall product analytics migration", () => {
  test("backfills opaque unique IDs without synthesizing lifecycle history", () => {
    const rows = z
      .array(
        z.object({
          serverId: z.string(),
          analyticsInstallationId: z.uuid(),
          analyticsLifecycleTracked: z.literal(0),
          firstCoreOutputAt: z.null(),
          removedAt: z.string().nullable(),
        }),
      )
      .parse(
        database
          .query(
            `SELECT "serverId", "analyticsInstallationId", "analyticsLifecycleTracked", "firstCoreOutputAt", "removedAt" FROM "GuildInstall" ORDER BY "serverId"`,
          )
          .all(),
      );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.analyticsInstallationId).not.toBe(
      rows[1]?.analyticsInstallationId,
    );
    expect(rows[0]?.removedAt).toBeNull();
    expect(rows[1]?.removedAt).toBe("2026-03-01");
  });
});
