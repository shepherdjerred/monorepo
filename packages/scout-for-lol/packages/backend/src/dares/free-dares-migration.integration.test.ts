import {
  replayMigrationsBefore,
  type MigrationReplay,
} from "#src/database/migration-replay.test-fixtures.ts";
import { afterEach, expect, test } from "vitest";

const MIGRATION = "20261025230000_standalone_free_dares";
let replay: MigrationReplay | undefined;
afterEach(() => {
  replay?.drop();
  replay = undefined;
});

function beforeRetirement() {
  replay = replayMigrationsBefore(
    `scout_test_free_dares_${Date.now().toString()}`,
    MIGRATION,
  );
  replay.psql(`
    INSERT INTO "BucksDare" (id, "serverId", "channelId", "challengerDiscordId", "openingStake", "updatedAt")
      VALUES (42, '100000000000000001', '300000000000000001', '200000000000000001', 20, NOW());
    INSERT INTO "BucksNotificationPreference" ("serverId", "discordId", "dareLifecycleDms", "dareProgressDms", "updatedAt")
      VALUES ('100000000000000001', '200000000000000001', false, true, NOW());
    INSERT INTO "ConfirmationIntent" (id, kind, "serverId", "actorDiscordId", payload, "idempotencyKey", "expiresAt", "dareId") VALUES
      ('old-dare', 'dare_fund', '100000000000000001', '200000000000000001', '{"kind":"dare_fund"}', 'old-dare', NOW() + INTERVAL '1 hour', 42),
      ('report', 'report', '100000000000000001', '200000000000000001', '{"kind":"report"}', 'report', NOW() + INTERVAL '1 hour', NULL);
  `);
  return replay;
}

test("resets private legacy drafts, preserves preferences and shared intents, and prevents ID reuse", () => {
  const db = beforeRetirement();
  db.applyMigration(MIGRATION);
  expect(db.psql('SELECT COUNT(*) FROM "Dare"')).toBe("0");
  expect(db.psql('SELECT COUNT(*) FROM "BucksDare"')).toBe("1");
  expect(db.psql('SELECT id FROM "ConfirmationIntent"')).toBe("report");
  expect(
    db.psql(
      'SELECT "dareLifecycleDms", "dareProgressDms" FROM "DareNotificationPreference"',
    ),
  ).toBe("f|t");
  expect(
    db.psql("SELECT nextval(pg_get_serial_sequence('\"Dare\"', 'id'))"),
  ).toBe("43");
}, 180_000);

test("refuses to strand a legacy Dare that became active after inventory", () => {
  const db = beforeRetirement();
  db.psql('UPDATE "BucksDare" SET "dareState" = \'active\' WHERE id = 42');
  expect(() => db.applyMigration(MIGRATION)).toThrow(
    "Open legacy positions remain",
  );
  expect(db.psql('SELECT COUNT(*) FROM "ConfirmationIntent"')).toBe("2");
  expect(db.psql("SELECT to_regclass('\"Dare\"') IS NULL")).toBe("t");
}, 180_000);

test("rebuilds definitely unsent prematch copy and returns only its tip claim", () => {
  const db = beforeRetirement();
  db.psql(`
    INSERT INTO "MatchNotificationIntent" ("intentKey", "riotMatchId", kind, "originKind", "targetKind", "targetId", state, "attemptCount", "attemptNonce", "unknownObservedAt", "freshnessDeadline", payload, "createdAt", "updatedAt") VALUES
      ('ready', 'NA1_1', 'prematch', 'live', 'channel', '300000000000000001', 'ready', 0, NULL, NULL, NOW() + INTERVAL '1 hour', '{"kind":"notification-intent"}', NOW(), NOW()),
      ('uncertain', 'NA1_2', 'prematch', 'live', 'channel', '300000000000000002', 'unknown-delivery', 1, 'uncertain-attempt', NOW(), NOW() + INTERVAL '1 hour', '{"kind":"notification-intent"}', NOW(), NOW());
    INSERT INTO "NotificationPresentation" ("intentKey", "serverId", "clashEnabled", "tipKey", "tipText", "messageJson", "updatedAt") VALUES
      ('ready', '100000000000000001', false, 'transfers', 'Old transfer tip', '{"version":1,"content":"Old market controls"}', NOW()),
      ('uncertain', '100000000000000002', false, 'transfers', 'Uncertain transfer tip', '{"version":1,"content":"Uncertain delivery evidence"}', NOW());
    INSERT INTO "FeatureTipImpression" ("serverId", "tipKey", "claimedAt") VALUES
      ('100000000000000001', 'transfers', NOW()), ('100000000000000002', 'transfers', NOW());
  `);
  db.applyMigration(MIGRATION);
  expect(
    db.psql(
      'SELECT "messageJson" IS NULL, "tipKey" IS NULL FROM "NotificationPresentation" WHERE "intentKey" = \'ready\'',
    ),
  ).toBe("t|t");
  expect(
    db.psql(
      'SELECT "messageJson" IS NOT NULL FROM "NotificationPresentation" WHERE "intentKey" = \'uncertain\'',
    ),
  ).toBe("t");
  expect(db.psql('SELECT "serverId" FROM "FeatureTipImpression"')).toBe(
    "100000000000000002",
  );
}, 180_000);
