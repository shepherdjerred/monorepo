import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { z } from "zod";

const ReportRowSchema = z.object({ queryText: z.string() });
const ColumnRowSchema = z.object({ name: z.string() });

describe("report bounds migration", () => {
  test("moves lookback and row bounds into ScoutQL before dropping columns", async () => {
    const database = new Database(":memory:");
    try {
      database.run(LEGACY_REPORT_SCHEMA);
      insertReport(database, {
        id: 1,
        query:
          "SELECT games FROM match_participants GROUP BY player RENDER leaderboard",
        lookbackDays: 14,
        maxRows: 8,
      });
      insertReport(database, {
        id: 2,
        query:
          "SELECT games FROM match_participants WHERE queue IN (solo) GROUP BY player LIMIT 5 RENDER table",
        lookbackDays: 30,
        maxRows: 10,
      });
      insertReport(database, {
        id: 3,
        query:
          "SELECT prematches FROM prematch_participants GROUP BY champion RENDER table",
        lookbackDays: 7,
        maxRows: 6,
      });
      insertReport(database, {
        id: 4,
        query:
          "SELECT games FROM match_participants GROUP BY player LIMIT 25 RENDER table",
        lookbackDays: 60,
        maxRows: 10,
      });

      const migrationPath = `${import.meta.dir}/../../prisma/migrations/20260712000000_reports_query_owned_bounds/migration.sql`;
      database.run(await Bun.file(migrationPath).text());

      const rows = database
        .query("SELECT queryText FROM Report ORDER BY id")
        .all()
        .map((row) => ReportRowSchema.parse(row));
      expect(rows[0]?.queryText).toContain(
        "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL '14 days'",
      );
      expect(rows[0]?.queryText).toContain("LIMIT 8 RENDER");
      expect(rows[1]?.queryText).toContain(
        "queue IN (solo) AND game_creation_at",
      );
      expect(rows[1]?.queryText).toContain("LIMIT 5");
      expect(rows[2]?.queryText).toContain(
        "observed_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'",
      );
      expect(rows[3]?.queryText).toContain("LIMIT 10 RENDER");

      const columns = database
        .query("PRAGMA table_info('Report')")
        .all()
        .map((row) => ColumnRowSchema.parse(row).name);
      expect(columns).not.toContain("lookbackDays");
      expect(columns).not.toContain("maxRows");
      expect(columns).toContain("scheduleTimezone");
      expect(columns).toContain("lastScheduledLocalDate");
    } finally {
      database.close();
    }
  });
});

function insertReport(
  database: Database,
  params: {
    id: number;
    query: string;
    lookbackDays: number;
    maxRows: number;
  },
): void {
  database
    .query(
      `INSERT INTO Report (
        id, serverId, ownerId, channelId, title, description, queryText,
        lookbackDays, maxRows, isEnabled, isSystemManaged, systemSource,
        sourceCompetitionId, cronExpression, nextScheduledRunAt,
        lastScheduledRunAt, lastRunStatus, lastRunError, createdTime, updatedTime
      ) VALUES (?, 'guild', 'owner', 'channel', 'Title', NULL, ?, ?, ?, 1, 0,
        NULL, NULL, '0 0 * * *', NULL, NULL, NULL, NULL,
        '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z')`,
    )
    .run(params.id, params.query, params.lookbackDays, params.maxRows);
}

const LEGACY_REPORT_SCHEMA = `
  CREATE TABLE Report (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    serverId TEXT NOT NULL,
    ownerId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    queryText TEXT NOT NULL,
    lookbackDays INTEGER NOT NULL DEFAULT 30,
    maxRows INTEGER NOT NULL DEFAULT 10,
    isEnabled BOOLEAN NOT NULL DEFAULT true,
    isSystemManaged BOOLEAN NOT NULL DEFAULT false,
    systemSource TEXT,
    sourceCompetitionId INTEGER,
    cronExpression TEXT NOT NULL,
    nextScheduledRunAt DATETIME,
    lastScheduledRunAt DATETIME,
    lastRunStatus TEXT,
    lastRunError TEXT,
    createdTime DATETIME NOT NULL,
    updatedTime DATETIME NOT NULL
  );
  CREATE INDEX Report_serverId_isEnabled_idx ON Report(serverId, isEnabled);
  CREATE INDEX Report_nextScheduledRunAt_idx ON Report(nextScheduledRunAt);
  CREATE INDEX Report_sourceCompetitionId_idx ON Report(sourceCompetitionId);
  CREATE INDEX Report_systemSource_idx ON Report(systemSource);
`;
