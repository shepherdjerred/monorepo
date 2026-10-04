import { afterEach, describe, expect, test } from "vitest";
import {
  replayMigrationsBefore,
  type MigrationReplay,
} from "#src/database/migration-replay.test-fixtures.ts";

/**
 * The Dares v3-only migration deletes the retired dare-summary result posts.
 * A post still owed to its channel is a committed public result whose Dare
 * will never settle again, so the migration must refuse rather than discard
 * it; a terminal one is safe to drop.
 */

const MIGRATION = "20261003000000_dares_v3_only";
const CHANNEL = "300000000000000001";

let replay: MigrationReplay | undefined;

afterEach(() => {
  replay?.drop();
  replay = undefined;
});

function freshReplay(label: string): MigrationReplay {
  replay = replayMigrationsBefore(
    `scout_test_${Date.now().toString()}_dares_v3_${label}`,
    MIGRATION,
  );
  return replay;
}

function insertDareSummary(
  db: MigrationReplay,
  input: { key: string; state: "pending" | "ready" | "delivered" },
): void {
  const delivered = input.state === "delivered" ? "NOW()" : "NULL";
  db.psql(`
    INSERT INTO "MatchNotificationIntent"
      ("intentKey", "riotMatchId", "targetKind", "targetId", state,
       "deliveredAt", "freshnessDeadline", payload, "createdAt", "updatedAt",
       kind, "originKind", "subjectKind", "subjectId")
    VALUES
      ('${input.key}', 'NA1_7000000001', 'channel', '${CHANNEL}',
       '${input.state}', ${delivered}, NOW() + INTERVAL '1 hour',
       '{"kind":"notification-intent"}', NOW(), NOW(),
       'dare-summary', 'live', 'match', 'NA1_7000000001');
  `);
}

function dareSummaryCount(db: MigrationReplay): string {
  return db.psql(
    `SELECT COUNT(*) FROM "MatchNotificationIntent" WHERE kind = 'dare-summary'`,
  );
}

describe("the Dares v3-only migration", () => {
  test.each(["pending", "ready"] as const)(
    "refuses while a dare-summary result is still %s",
    (state) => {
      const db = freshReplay(state);
      insertDareSummary(db, { key: `dare-summary:${state}`, state });

      expect(() => {
        db.applyMigration(MIGRATION);
      }).toThrow(/Undelivered dare-summary results remain/);
      // The guard runs before any change, so the owed result is still there
      // to deliver.
      expect(dareSummaryCount(db)).toBe("1");
    },
    180_000,
  );

  test("drops dare-summary results that are already terminal", () => {
    const db = freshReplay("delivered");
    insertDareSummary(db, {
      key: "dare-summary:delivered",
      state: "delivered",
    });

    db.applyMigration(MIGRATION);

    expect(dareSummaryCount(db)).toBe("0");
  }, 180_000);
});
