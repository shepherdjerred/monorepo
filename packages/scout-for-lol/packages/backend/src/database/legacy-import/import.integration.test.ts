import { afterAll, describe, expect, test } from "vitest";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { LEGACY_TABLE_COLUMNS } from "#src/testing/legacy-sqlite-fixture.ts";
import {
  runImport,
  verifyImport,
  verifyLedgerBalances,
} from "#src/database/legacy-import/run-import.ts";
import {
  AccountIdSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
  SubscriptionIdSchema,
} from "@scout-for-lol/data";

// The importer runs with a bare PrismaClient in production (the entrypoint
// CLI); testing through the same client type keeps the surfaces identical.
function bareClient(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const { dbUrl } = createTestDatabase("legacy-import");
const prisma = bareClient(dbUrl);
const GUILD = DiscordGuildIdSchema.parse("111222333444555666");
const OWNER = DiscordAccountIdSchema.parse("222333444555666777");
const PUUID = "p".repeat(78);
const NOW = 1_755_600_000_000; // epoch ms, as the legacy adapter stored dates

function sqliteValues(
  row: Record<string, unknown>,
  keys: readonly string[],
): (string | number | bigint | null)[] {
  return keys
    .map((key) => row[key])
    .map((value) => {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint" ||
        value === null
      ) {
        return value;
      }
      throw new Error(
        `fixture value not sqlite-storable: ${JSON.stringify(value)}`,
      );
    });
}

function buildLegacySqlite(
  path: string,
  omittedTables: ReadonlySet<string> = new Set(),
  omittedColumns: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): void {
  const db = new Database(path);
  try {
    const tableColumns = new Map<string, ReadonlySet<string>>();
    for (const [table, columns] of Object.entries(LEGACY_TABLE_COLUMNS)) {
      if (omittedTables.has(table)) {
        continue;
      }
      const excluded = omittedColumns.get(table) ?? new Set<string>();
      const presentColumns = columns.filter((column) => !excluded.has(column));
      tableColumns.set(table, new Set(presentColumns));
      const cols = presentColumns.map((column) => `"${column}"`).join(", ");
      db.run(`CREATE TABLE "${table}" (${cols})`);
    }
    const insert = (table: string, row: Record<string, unknown>): void => {
      const columns = tableColumns.get(table);
      if (columns === undefined) {
        throw new Error(`fixture table is omitted: ${table}`);
      }
      const keys = Object.keys(row).filter((key) => columns.has(key));
      const placeholders = keys.map(() => "?").join(", ");
      const cols = keys.map((key) => `"${key}"`).join(", ");
      const values = sqliteValues(row, keys);
      db.query(`INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`).run(
        ...values,
      );
    };

    insert("Player", {
      id: 1,
      alias: "alpha",
      discordId: OWNER,
      serverId: GUILD,
      creatorDiscordId: OWNER,
      createdTime: NOW,
      updatedTime: NOW,
    });
    insert("Player", {
      id: 3, // deliberate gap: MAX(id)=3 exercises the sequence reset
      alias: "bravo",
      discordId: null,
      serverId: GUILD,
      creatorDiscordId: OWNER,
      createdTime: NOW,
      updatedTime: NOW,
    });
    insert("Account", {
      id: 1,
      alias: "alpha-main",
      puuid: PUUID,
      region: "AMERICA_NORTH",
      playerId: 1,
      riotGameName: "Alpha",
      riotTagLine: null,
      riotIdUpdatedAt: null,
      lastProcessedMatchId: "NA1_1234567890",
      lastMatchTime: NOW - 5000,
      lastCheckedAt: null,
      serverId: GUILD,
      creatorDiscordId: OWNER,
      createdTime: NOW,
      updatedTime: NOW,
    });
    insert("Subscription", {
      id: 7,
      playerId: 1,
      channelId: "333444555666777888",
      filters: null,
      isMuted: 0,
      serverId: GUILD,
      creatorDiscordId: OWNER,
      createdTime: NOW,
      updatedTime: NOW,
    });
    insert("User", {
      discordId: OWNER,
      discordUsername: "alpha",
      discordAvatar: null,
      discordAccessToken: null,
      discordRefreshToken: null,
      tokenExpiresAt: null,
      analyticsUserId: "analytics-user-1",
      createdAt: NOW,
      updatedAt: NOW,
      lastSeenAt: NOW + 1_000,
    });
    insert("GuildInstall", {
      id: 1,
      serverId: GUILD,
      serverName: "Alpha guild",
      ownerDiscordId: OWNER,
      addedByDiscordId: OWNER,
      memberCount: 10,
      installedAt: NOW,
      analyticsInstallationId: "analytics-install-1",
      analyticsLifecycleTracked: 1,
      firstSubscriptionAt: null,
      firstCoreOutputAt: null,
      outreach3dSentAt: null,
      outreach14dSentAt: null,
      outreach30dSentAt: null,
      emailNudgeSentAt: null,
      removedAt: null,
      attributedAt: NOW + 2_000,
      attributionSurface: "landing",
    });
    if (tableColumns.has("InstallAttributionToken")) {
      insert("InstallAttributionToken", {
        id: 1,
        token: "install-token-1",
        discordId: OWNER,
        surface: "landing",
        createdAt: NOW,
        expiresAt: NOW + 86_400_000,
        consumedAt: null,
        guildId: GUILD,
        reconciledAt: null,
      });
    }
    insert("Season", {
      id: "2026-split-2",
      displayName: "2026 Split 2",
      startDate: NOW - 86_400_000,
      endDate: NOW + 86_400_000,
    });
    insert("ActiveGame", {
      id: 2,
      gameId: 8_555_444_333_222_111n, // beyond Int32: exercises BigInt
      trackedPuuids: `["${PUUID}"]`,
      prematchMessageIds: "[]",
      prematchMatchId: null,
      detectedAt: NOW,
      expiresAt: NOW + 3 * 3_600_000,
      updatedAt: NOW,
    });
    insert("BucksAccount", {
      id: 1,
      serverId: GUILD,
      discordId: OWNER,
      isHouse: 0,
      balance: 90,
      peekPassExpiresAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    insert("BucksMatchPool", {
      id: 1,
      matchId: "NA1_pool_1",
      serverId: GUILD,
      detectedAt: NOW,
      peekAvailableAt: NOW + 120_000,
      closesAt: NOW + 300_000,
      queueType: "RANKED_SOLO_5x5",
      roster: "{}",
      messageRefs: "[]",
      prematchContentBase: null,
      poolState: "open",
      matchedAt: null,
      matchingJson: null,
      winningTeamId: null,
      voidReason: null,
      predictionJson: null,
      settledAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    insert("BucksBet", {
      id: 1,
      poolId: 1,
      bucksAccountId: 1,
      predictedTeamId: 100,
      subjectPuuid: PUUID,
      stake: 10,
      humanMatchedStake: null,
      houseMatchedStake: null,
      matchedStake: null,
      unmatchedStake: null,
      betOutcome: "pending",
      grossPayout: null,
      fee: null,
      payout: null,
      cancelledAt: null,
      settledAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    insert("BucksLedgerEntry", {
      id: 1,
      bucksAccountId: 1,
      delta: 100,
      balanceAfter: 100,
      kind: "seed",
      matchId: null,
      betId: null,
      parlayBetId: null,
      predictedTeamId: null,
      actualWinningTeamId: null,
      context: "{}",
      createdAt: NOW,
    });
    insert("BucksLedgerEntry", {
      id: 2,
      bucksAccountId: 1,
      delta: -10,
      balanceAfter: 90,
      kind: "bet_stake",
      matchId: null,
      betId: null,
      parlayBetId: null,
      predictedTeamId: null,
      actualWinningTeamId: null,
      context: "{}",
      createdAt: NOW,
    });
    insert("BucksMatchEarning", {
      matchId: "NA1_earning_1",
      serverId: GUILD,
      awardedAt: NOW,
      phase: "prematch",
      state: "pending",
      targetSnapshotJson: "[]",
      retryAt: NOW + 60_000,
      matchCreatedAt: NOW,
      entryCount: 1,
    });
  } finally {
    db.close();
  }
}

const fixtureDir = `${tmpdir()}/legacy-import-fixture-${Date.now().toString()}-${Math.random().toString(36).slice(2)}`;
Bun.spawnSync(["mkdir", "-p", fixtureDir]);
const fixturePath = `${fixtureDir}/legacy.sqlite`;
const oldSchemaDbUrl = createTestDatabase("legacy-import-old-schema").dbUrl;
const oldSchemaPrisma = bareClient(oldSchemaDbUrl);
const oldSchemaFixturePath = `${fixtureDir}/legacy-old-schema.sqlite`;

afterAll(async () => {
  await prisma.$disconnect();
  await oldSchemaPrisma.$disconnect();
});

describe("legacy sqlite import", () => {
  test("imports, verifies, re-runs idempotently, and resets sequences", async () => {
    buildLegacySqlite(fixturePath);
    // The test-template ships seeded Season rows; the import path expects the
    // empty database `prisma migrate deploy` leaves behind.
    await prisma.season.deleteMany();

    const summary = await runImport({ prisma, sqlitePath: fixturePath });
    expect(summary.action).toBe("imported");
    expect(summary.rowCounts["Player"]).toBe(2);
    expect(summary.rowCounts["BucksLedgerEntry"]).toBe(2);
    expect(summary.rowCounts["BucksMatchEarning"]).toBe(1);
    expect(summary.rowCounts["InstallAttributionToken"]).toBe(1);

    await expect(
      prisma.user.findUniqueOrThrow({ where: { discordId: OWNER } }),
    ).resolves.toMatchObject({ lastSeenAt: new Date(NOW + 1_000) });
    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { id: 1 } }),
    ).resolves.toMatchObject({
      attributedAt: new Date(NOW + 2_000),
      attributionSurface: "landing",
    });
    await expect(
      prisma.installAttributionToken.findUniqueOrThrow({ where: { id: 1 } }),
    ).resolves.toMatchObject({
      token: "install-token-1",
      guildId: GUILD,
      consumedAt: null,
    });

    // Converted storage formats round-trip.
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: AccountIdSchema.parse(1) },
    });
    expect(account.lastMatchTime?.getTime()).toBe(NOW - 5000);
    expect(account.lastCheckedAt).toBeNull();
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: SubscriptionIdSchema.parse(7) },
    });
    expect(subscription.isMuted).toBe(false);
    const game = await prisma.activeGame.findUniqueOrThrow({
      where: { id: 2 },
    });
    expect(game.gameId).toBe(8_555_444_333_222_111n);
    await expect(
      prisma.bucksMatchEarning.findUniqueOrThrow({
        where: {
          matchId_serverId: { matchId: "NA1_earning_1", serverId: GUILD },
        },
      }),
    ).resolves.toMatchObject({ phase: "prematch", state: "pending" });

    // Idempotency: the marker short-circuits a restart.
    const rerun = await runImport({ prisma, sqlitePath: fixturePath });
    expect(rerun.action).toBe("skipped");

    // Full before/after comparison is clean, including the ledger invariant.
    expect(await verifyImport({ prisma, sqlitePath: fixturePath })).toEqual([]);
    expect(await verifyLedgerBalances(prisma)).toEqual([]);

    // Sequence reset: the next insert must not collide with imported ids.
    const created = await prisma.player.create({
      data: {
        alias: "charlie",
        serverId: GUILD,
        creatorDiscordId: OWNER,
        createdTime: new Date(NOW),
        updatedTime: new Date(NOW),
      },
    });
    expect(created.id).toBe(PlayerIdSchema.parse(4));
  });

  test("imports the promoted SQLite schema without later parlay tables", async () => {
    const omittedColumns = new Map<string, ReadonlySet<string>>([
      ["User", new Set(["lastSeenAt"])],
      ["GuildInstall", new Set(["attributedAt", "attributionSurface"])],
      ["BucksAccount", new Set(["isHouse", "peekPassExpiresAt"])],
      [
        "BucksBet",
        new Set([
          "humanMatchedStake",
          "houseMatchedStake",
          "matchedStake",
          "unmatchedStake",
          "grossPayout",
          "fee",
          "cancelledAt",
        ]),
      ],
      ["BucksLedgerEntry", new Set(["parlayBetId"])],
      [
        "BucksMatchPool",
        new Set([
          "peekAvailableAt",
          "prematchContentBase",
          "matchedAt",
          "matchingJson",
        ]),
      ],
      [
        "BucksMatchEarning",
        new Set([
          "phase",
          "state",
          "targetSnapshotJson",
          "retryAt",
          "matchCreatedAt",
        ]),
      ],
    ]);
    buildLegacySqlite(
      oldSchemaFixturePath,
      new Set([
        "InstallAttributionToken",
        "BucksOpenPosition",
        "BucksParlayDefinition",
        "BucksParlayMarket",
        "BucksParlayBet",
      ]),
      omittedColumns,
    );
    await oldSchemaPrisma.season.deleteMany();

    const summary = await runImport({
      prisma: oldSchemaPrisma,
      sqlitePath: oldSchemaFixturePath,
    });

    expect(summary.action).toBe("imported");
    expect(summary.rowCounts["BucksOpenPosition"]).toBe(1);
    expect(summary.rowCounts["BucksParlayDefinition"]).toBe(0);
    expect(summary.rowCounts["BucksParlayMarket"]).toBe(0);
    expect(summary.rowCounts["BucksParlayBet"]).toBe(0);
    await expect(
      oldSchemaPrisma.bucksOpenPosition.findUniqueOrThrow({
        where: {
          poolId_bucksAccountId: { poolId: 1, bucksAccountId: 1 },
        },
      }),
    ).resolves.toMatchObject({ betId: 1, createdAt: new Date(NOW) });
    await expect(
      oldSchemaPrisma.bucksAccount.findUniqueOrThrow({ where: { id: 1 } }),
    ).resolves.toMatchObject({ isHouse: false, peekPassExpiresAt: null });
    await expect(
      oldSchemaPrisma.bucksMatchPool.findUniqueOrThrow({ where: { id: 1 } }),
    ).resolves.toMatchObject({
      peekAvailableAt: new Date(NOW + 300_000),
      prematchContentBase: null,
      matchedAt: null,
      matchingJson: null,
    });
    await expect(
      oldSchemaPrisma.bucksBet.findUniqueOrThrow({ where: { id: 1 } }),
    ).resolves.toMatchObject({
      humanMatchedStake: null,
      houseMatchedStake: null,
      matchedStake: null,
      unmatchedStake: null,
      grossPayout: null,
      fee: null,
      cancelledAt: null,
    });
    await expect(
      oldSchemaPrisma.bucksMatchEarning.findUniqueOrThrow({
        where: {
          matchId_serverId: { matchId: "NA1_earning_1", serverId: GUILD },
        },
      }),
    ).resolves.toMatchObject({
      phase: "postmatch",
      state: "complete",
      targetSnapshotJson: "[]",
      retryAt: new Date(NOW),
      matchCreatedAt: new Date(NOW),
    });
    expect(
      await verifyImport({
        prisma: oldSchemaPrisma,
        sqlitePath: oldSchemaFixturePath,
      }),
    ).toEqual([]);
  });
});

describe("legacy sqlite import safety", () => {
  test("refuses to trust a marker after the sqlite source changes", async () => {
    const changedFixturePath = `${fixtureDir}/legacy-changed.sqlite`;
    await Bun.write(
      changedFixturePath,
      await Bun.file(fixturePath).arrayBuffer(),
    );
    const changed = new Database(changedFixturePath);
    changed.run('UPDATE "Player" SET "alias" = ? WHERE "id" = 1', [
      "changed-after-import",
    ]);
    changed.close();

    await expect(
      runImport({ prisma, sqlitePath: changedFixturePath }),
    ).rejects.toThrow("source changed after import");
  });

  test("verify detects tampered content and ledger drift", async () => {
    // The previous test added a player, so Player reports a count mismatch;
    // Subscription (count-stable) exercises the content-digest path.
    await prisma.subscription.update({
      where: { id: SubscriptionIdSchema.parse(7) },
      data: { filters: "tampered" },
    });
    const mismatches = await verifyImport({ prisma, sqlitePath: fixturePath });
    expect(
      mismatches.some((m) => m.model === "Player" && m.kind === "count"),
    ).toBe(true);
    expect(
      mismatches.some(
        (m) => m.model === "Subscription" && m.kind === "content",
      ),
    ).toBe(true);
    await prisma.subscription.update({
      where: { id: SubscriptionIdSchema.parse(7) },
      data: { filters: null },
    });

    await prisma.bucksAccount.update({
      where: { id: 1 },
      data: { balance: 91 },
    });
    const drift = await verifyLedgerBalances(prisma);
    expect(drift).toHaveLength(1);
  });

  test("refuses to import into a populated database without a marker", async () => {
    const other = bareClient(
      createTestDatabase("legacy-import-populated").dbUrl,
    );
    try {
      await other.player.create({
        data: {
          alias: "existing",
          serverId: GUILD,
          creatorDiscordId: OWNER,
          createdTime: new Date(NOW),
          updatedTime: new Date(NOW),
        },
      });
      await expect(
        runImport({ prisma: other, sqlitePath: fixturePath }),
      ).rejects.toThrow(/no import marker/);
    } finally {
      await other.$disconnect();
    }
  });

  test("records a fresh-install marker when no sqlite exists", async () => {
    const fresh = bareClient(createTestDatabase("legacy-import-fresh").dbUrl);
    try {
      await expect(
        runImport({
          prisma: fresh,
          sqlitePath: `${fixtureDir}/does-not-exist.sqlite`,
        }),
      ).rejects.toThrow(/explicitly empty deployment/);
      const summary = await runImport({
        prisma: fresh,
        sqlitePath: `${fixtureDir}/does-not-exist.sqlite`,
        allowFreshInstall: true,
      });
      expect(summary.action).toBe("fresh");
      await expect(
        runImport({ prisma: fresh, sqlitePath: fixturePath }),
      ).rejects.toThrow("fresh install but a sqlite source now exists");
      const rerun = await runImport({
        prisma: fresh,
        sqlitePath: `${fixtureDir}/does-not-exist.sqlite`,
      });
      expect(rerun.action).toBe("skipped");
    } finally {
      await fresh.$disconnect();
    }
  });
});
