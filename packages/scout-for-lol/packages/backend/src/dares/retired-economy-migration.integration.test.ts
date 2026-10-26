import {
  replayMigrationsBefore,
  type MigrationReplay,
} from "#src/database/migration-replay.test-fixtures.ts";
import { afterEach, expect, test } from "vitest";

const MIGRATION = "20261026200000_drop_retired_economy";
let replay: MigrationReplay | undefined;
afterEach(() => {
  replay?.drop();
  replay = undefined;
});

function beforeDrop() {
  replay = replayMigrationsBefore(
    `scout_test_drop_economy_${Date.now().toString()}`,
    MIGRATION,
  );
  replay.psql(`
    INSERT INTO "User" ("discordId", "discordUsername", "analyticsUserId", "updatedAt")
      VALUES ('200000000000000001', 'retained-user', 'retained-user-analytics', NOW());
    INSERT INTO "Dare" (id, "serverId", "channelId", "challengerDiscordId", "updatedAt")
      VALUES (100, '100000000000000001', '300000000000000001', '200000000000000001', NOW());
    INSERT INTO "DareNotificationPreference" ("serverId", "discordId", "dareLifecycleDms", "updatedAt")
      VALUES ('100000000000000001', '200000000000000001', false, NOW());
    INSERT INTO "BucksDare" (id, "serverId", "channelId", "challengerDiscordId", "openingStake", "updatedAt")
      VALUES (42, '100000000000000001', '300000000000000001', '200000000000000001', 20, NOW());
    INSERT INTO "BucksAccount" (id, "serverId", "discordId", "analyticsUserId", "updatedAt")
      VALUES (1, '100000000000000001', '200000000000000001', 'retired-account-analytics', NOW());
    INSERT INTO "BucksMatchPool" (id, "matchId", "serverId", "detectedAt", "closesAt", roster, "updatedAt")
      VALUES (1, 'NA1_1', '100000000000000001', NOW(), NOW(), '[]', NOW());
  `);
  return replay;
}

function tables(db: MigrationReplay) {
  return db
    .psql(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    )
    .split("\n");
}

function rowCounts(db: MigrationReplay, names: string[]) {
  for (const name of names) {
    if (!/^[a-z_]\w*$/iu.test(name))
      throw new Error(`Unexpected table: ${name}`);
  }
  return db.psql(
    names
      .map((name) => `SELECT '${name}', COUNT(*) FROM "${name}";`)
      .join("\n"),
  );
}

test("drops every legacy economy table and preserves every retained table's rows", () => {
  const db = beforeDrop();
  const all = tables(db);
  const legacy = all.filter(
    (name) =>
      name.startsWith("Bucks") || name === "MatchSettlementAnnouncement",
  );
  expect(legacy).toHaveLength(21);
  const retained = all.filter((name) => !legacy.includes(name));
  const before = rowCounts(db, retained);
  db.applyMigration(MIGRATION);
  expect(tables(db)).toEqual(retained);
  expect(rowCounts(db, retained)).toBe(before);
  expect(db.psql('SELECT id FROM "Dare"')).toBe("100");
  expect(
    db.psql('SELECT "dareLifecycleDms" FROM "DareNotificationPreference"'),
  ).toBe("f");
}, 180_000);

test.each([
  [
    "pending match bet",
    `INSERT INTO "BucksBet" ("poolId", "bucksAccountId", "predictedTeamId", "subjectPuuid", stake, "updatedAt") VALUES (1, 1, 100, 'test-puuid', 1, NOW())`,
  ],
  [
    "pending parlay bet",
    `
    INSERT INTO "BucksParlayDefinition" (id, "matchId", "queueType", "selectedTeamId", subjects, criteria, "yesProbabilityBps", "promptVersion", "catalogVersion", "schemaVersion", "evaluatorVersion", "generationContext", "requestedModel", usage, "durationMs") VALUES (1, 'NA1_1', 'ranked-solo-5x5', 100, '[]', '[]', 5000, 'test', 'test', 1, 'test', '{}', 'test', '{}', 0);
    INSERT INTO "BucksParlayMarket" (id, "definitionId", "outcomePoolId", "matchId", "serverId", "publishedAt", "closesAt", "updatedAt") VALUES (1, 1, 1, 'NA1_1', '100000000000000001', NOW(), NOW(), NOW());
    INSERT INTO "BucksParlayBet" ("marketId", "bucksAccountId", side, stake, "houseReserve", "grossPayout", "updatedAt") VALUES (1, 1, 'YES', 1, 1, 2, NOW());
  `,
  ],
  ...["pending_accept", "activating", "active"].map((state) => [
    state + " Dare",
    `UPDATE "BucksDare" SET "dareState" = '${state}' WHERE id = 42`,
  ]),
  ...["queued", "running"].map((state) => [
    state + " parlay generation",
    `INSERT INTO "ScoutTemporalWork" (id, kind, payload, state, "updatedAt") VALUES ('guard-check', 'parlay-generation', '{}', '${state}', NOW())`,
  ]),
])(
  "refuses %s atomically",
  (_name, seed) => {
    const db = beforeDrop();
    if (seed === undefined) throw new Error("Missing guard fixture");
    db.psql(seed);
    const names = tables(db);
    const before = rowCounts(db, names);
    expect(() => db.applyMigration(MIGRATION)).toThrow(
      "Legacy economic work remains",
    );
    expect(tables(db)).toEqual(names);
    expect(rowCounts(db, names)).toBe(before);
  },
  180_000,
);
