import {
  replayMigrationsBefore,
  type MigrationReplay,
} from "#src/database/migration-replay.test-fixtures.ts";
import { settlementEvidenceCodec } from "#src/durable/match/receipt-evidence.ts";
import { afterEach, expect, test } from "vitest";

const MIGRATION = "20261027010000_purge_retired_economy_metadata";
let replay: MigrationReplay | undefined;
afterEach(() => {
  replay?.drop();
  replay = undefined;
});

function seedIntent(
  db: MigrationReplay,
  key: string,
  kind: "settlement" | "postmatch" | "product-announcement",
  effect?: "weekly-bucks" | "competition",
) {
  const announcement =
    effect === undefined
      ? undefined
      : {
          kind: "scout-product-announcement",
          version: 1,
          data: { effect: { kind: effect } },
        };
  const payload = JSON.stringify({
    kind: "notification-intent",
    version: 3,
    data: { key, kind, announcement, state: { kind: "expired" } },
  });
  db.psql(`
    INSERT INTO "MatchNotificationIntent"
      ("intentKey", "subjectKind", "subjectId", "riotMatchId", kind, "originKind", "targetKind", "targetId", state, "freshnessDeadline", payload, "createdAt", "updatedAt")
    VALUES ('${key}', '${effect === undefined ? "match" : "announcement"}', '${effect === undefined ? "NA1_1" : key}', ${effect === undefined ? "'NA1_1'" : "NULL"}, '${kind}', 'live', 'channel', '300000000000000001', 'expired', NOW(), '${payload}', NOW(), NOW());
    INSERT INTO "NotificationPresentation" ("intentKey", "serverId", "clashEnabled", "messageJson", "updatedAt")
    VALUES ('${key}', '100000000000000001', false, '{}', NOW());
  `);
}

function beforePurge() {
  replay = replayMigrationsBefore(
    `scout_test_purge_metadata_${Date.now().toString()}`,
    MIGRATION,
  );
  const db = replay;
  seedIntent(db, "old-settlement", "settlement");
  seedIntent(db, "old-weekly", "product-announcement", "weekly-bucks");
  seedIntent(db, "retained-report", "postmatch");
  seedIntent(db, "retained-competition", "product-announcement", "competition");
  db.psql(`
    INSERT INTO "ScoutTemporalWork" (id, kind, payload, state, "updatedAt") VALUES
      ('old-parlay', 'parlay-generation', '{}', 'completed', NOW()),
      ('retained-mastery', 'champion-mastery-refresh', '{}', 'completed', NOW());
    INSERT INTO "DmAuditLog" ("recipientId", kind, content, "deliveryStatus") VALUES
      ('200000000000000001', 'betting_settlement_receipt', 'old recap', 'sent'),
      ('200000000000000001', 'betting_player_bet_outcome', 'old outcome', 'sent'),
      ('200000000000000001', 'support_reply', 'keep this', 'sent');
    INSERT INTO "MatchProcessingReceipt" ("riotMatchId", kind, version, "scopeKind", "scopeKey", evidence, "recordedAt") VALUES
      ('NA1_1', 'prematch-markets', 1, 'global', 'global', '{}', NOW()),
      ('NA1_1', 'v2-notification-render-settlement', 1, 'global', 'global', '{}', NOW()),
      ('NA1_1', 'settlement', 1, 'global', 'global', '{"kind":"settlement-evidence","version":1,"data":{"closedBetIds":[1],"settledBetIds":[2],"resolvedDareIds":[3],"settledParlayGuildIds":[],"earnedDiscordIds":[]}}', NOW()),
      ('NA1_2', 'settlement', 1, 'global', 'global', '{"kind":"settlement-evidence","version":2,"data":{"resolvedDareIds":[100]}}', NOW()),
      ('NA1_1', 'report-delivery', 1, 'global', 'global', '{"unchanged":true}', NOW());
    INSERT INTO "ScoutWorkflowStart" ("requestId", "requestedWorkflowId", "workflowType", "requestSource", "inputPayload", "requestedAt", "updatedAt") VALUES
      ('00000000-0000-4000-8000-000000000001', 'old-notification', 'scoutNotificationWorkflow', 'test', '{"kind":"scoutNotificationWorkflow","version":1,"data":{"intentKey":"old-weekly"}}', NOW(), NOW()),
      ('00000000-0000-4000-8000-000000000002', 'old-parlay', 'scoutDetachedWorkWorkflow', 'test', '{"kind":"scoutDetachedWorkWorkflow","version":1,"data":{"kind":"parlay-generation"}}', NOW(), NOW()),
      ('00000000-0000-4000-8000-000000000003', 'retained-notification', 'scoutNotificationWorkflow', 'test', '{"kind":"scoutNotificationWorkflow","version":1,"data":{"intentKey":"retained-report"}}', NOW(), NOW());
    INSERT INTO "FeatureTipImpression" ("serverId", "tipKey") VALUES
      ('100000000000000001', 'transfers'), ('100000000000000001', 'explore');
    INSERT INTO "Dare" (id, "serverId", "channelId", "challengerDiscordId", "updatedAt")
      VALUES (100, '100000000000000001', '300000000000000001', '200000000000000001', NOW());
    INSERT INTO "DareNotificationPreference" ("serverId", "discordId", "dareLifecycleDms", "updatedAt")
      VALUES ('100000000000000001', '200000000000000001', false, NOW());
  `);
  return db;
}

function retainedRows(db: MigrationReplay) {
  return db.psql(`
    SELECT row_to_json(t) FROM "MatchNotificationIntent" t WHERE "intentKey" LIKE 'retained-%' ORDER BY "intentKey";
    SELECT row_to_json(t) FROM "NotificationPresentation" t WHERE "intentKey" LIKE 'retained-%' ORDER BY "intentKey";
    SELECT row_to_json(t) FROM "ScoutWorkflowStart" t WHERE "requestedWorkflowId" LIKE 'retained-%';
    SELECT row_to_json(t) FROM "ScoutTemporalWork" t WHERE id = 'retained-mastery';
    SELECT row_to_json(t) FROM "DmAuditLog" t WHERE kind = 'support_reply';
    SELECT row_to_json(t) FROM "MatchProcessingReceipt" t WHERE "riotMatchId" = 'NA1_2' OR kind = 'report-delivery' ORDER BY id;
    SELECT row_to_json(t) FROM "FeatureTipImpression" t WHERE "tipKey" = 'explore';
    SELECT row_to_json(t) FROM "Dare" t;
    SELECT row_to_json(t) FROM "DareNotificationPreference" t;
  `);
}

test("purges terminal economy metadata, upgrades receipts, and preserves unrelated rows and free Dares", () => {
  const db = beforePurge();
  const retained = retainedRows(db);
  db.applyMigration(MIGRATION);
  expect(retainedRows(db)).toBe(retained);
  expect(
    db.psql(
      'SELECT "intentKey" FROM "MatchNotificationIntent" ORDER BY "intentKey"',
    ),
  ).toBe("retained-competition\nretained-report");
  expect(
    db.psql(
      'SELECT "intentKey" FROM "NotificationPresentation" ORDER BY "intentKey"',
    ),
  ).toBe("retained-competition\nretained-report");
  expect(
    db.psql('SELECT "requestedWorkflowId" FROM "ScoutWorkflowStart"'),
  ).toBe("retained-notification");
  expect(db.psql('SELECT kind FROM "ScoutTemporalWork"')).toBe(
    "champion-mastery-refresh",
  );
  expect(db.psql('SELECT kind FROM "DmAuditLog"')).toBe("support_reply");
  expect(db.psql('SELECT "tipKey" FROM "FeatureTipImpression"')).toBe(
    "explore",
  );
  expect(db.psql('SELECT count(*) FROM "MatchProcessingReceipt"')).toBe("3");
  const evidence: unknown = JSON.parse(
    db.psql(
      `SELECT evidence FROM "MatchProcessingReceipt" WHERE kind = 'settlement' AND "riotMatchId" = 'NA1_1'`,
    ),
  );
  expect(evidence).toEqual({
    kind: "settlement-evidence",
    version: 2,
    data: { resolvedDareIds: [3] },
  });
  expect(settlementEvidenceCodec.parse(evidence)).toEqual({
    resolvedDareIds: [3],
  });
  expect(() => seedIntent(db, "forbidden-recap", "settlement")).toThrow(
    "no_retired_economy_intents",
  );
  expect(() =>
    seedIntent(db, "forbidden-weekly", "product-announcement", "weekly-bucks"),
  ).toThrow("no_retired_economy_intents");
}, 180_000);

test("refuses unfinished work, ambiguous deliveries, and invalid receipt evidence atomically", () => {
  const db = beforePurge();
  const retained = retainedRows(db);
  for (const key of ["old-settlement", "old-weekly"]) {
    for (const state of ["pending", "ready", "sending", "unknown-delivery"]) {
      db.psql(`UPDATE "MatchNotificationIntent" SET state = '${state}', "attemptCount" = 1,
        "attemptNonce" = ${state === "sending" || state === "unknown-delivery" ? "'attempt'" : "NULL"},
        "sendStartedAt" = ${state === "sending" ? "NOW()" : "NULL"},
        "unknownObservedAt" = ${state === "unknown-delivery" ? "NOW()" : "NULL"}
        WHERE "intentKey" = '${key}'`);
      expect(() => db.applyMigration(MIGRATION)).toThrow(
        "Retired economy work is not terminal",
      );
      expect(db.psql('SELECT count(*) FROM "MatchNotificationIntent"')).toBe(
        "4",
      );
      expect(retainedRows(db)).toBe(retained);
    }
    db.psql(
      `UPDATE "MatchNotificationIntent" SET state = 'expired', "attemptNonce" = NULL, "sendStartedAt" = NULL, "unknownObservedAt" = NULL WHERE "intentKey" = '${key}'`,
    );
  }
  for (const state of ["queued", "running"]) {
    db.psql(
      `UPDATE "ScoutTemporalWork" SET state = '${state}' WHERE id = 'old-parlay'`,
    );
    expect(() => db.applyMigration(MIGRATION)).toThrow(
      "Retired economy work is not terminal",
    );
  }
  db.psql(
    `UPDATE "ScoutTemporalWork" SET state = 'completed' WHERE id = 'old-parlay'`,
  );
  for (const evidence of [
    "null",
    '{"kind":"settlement-evidence","version":3,"data":{"resolvedDareIds":[]}}',
    '{"kind":"settlement-evidence","version":1,"data":{"resolvedDareIds":[-1]}}',
    '{"kind":"settlement-evidence","version":1,"data":{"resolvedDareIds":[9007199254740992]}}',
  ]) {
    db.psql(
      `UPDATE "MatchProcessingReceipt" SET evidence = '${evidence}' WHERE kind = 'settlement' AND "riotMatchId" = 'NA1_1'`,
    );
    expect(() => db.applyMigration(MIGRATION)).toThrow(
      "Invalid retained Dare settlement evidence",
    );
    expect(db.psql('SELECT count(*) FROM "MatchNotificationIntent"')).toBe("4");
    expect(retainedRows(db)).toBe(retained);
  }
}, 180_000);
