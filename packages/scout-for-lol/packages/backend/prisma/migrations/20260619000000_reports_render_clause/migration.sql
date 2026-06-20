-- Reports now carry their display spec inside the query DSL via a trailing
-- `RENDER <kind> [WITH (...)]` clause, instead of a separate `outputFormat`
-- column. This migration does the data SEED and the schema MIGRATE in one file:
--
--   1. SEED  — backfill a `RENDER <kind>` clause into every existing report,
--              derived from its legacy outputFormat. Only the kind is needed;
--              channel defaults (x=label, y=first metric) resolve at render
--              time, reproducing the prior rendering exactly. Runs BEFORE the
--              column is dropped, while outputFormat is still readable.
--   2. MIGRATE — drop Report.outputFormat and ReportRun.outputFormat.

-- 1. Seed: append the RENDER clause to any report that doesn't already have one.
UPDATE "Report"
SET "queryText" = "queryText" || ' RENDER ' || LOWER("outputFormat")
WHERE lower("queryText") NOT LIKE '% render %';

-- 2. Migrate: drop the now-redundant outputFormat columns (SQLite table rebuild).
--    The Report INSERT...SELECT is a plain queryText copy — step 1 already seeded.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- RedefineTable: Report (drop outputFormat)
CREATE TABLE "new_Report" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "queryText" TEXT NOT NULL,
    "lookbackDays" INTEGER NOT NULL DEFAULT 30,
    "maxRows" INTEGER NOT NULL DEFAULT 10,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isSystemManaged" BOOLEAN NOT NULL DEFAULT false,
    "systemSource" TEXT,
    "sourceCompetitionId" INTEGER,
    "cronExpression" TEXT NOT NULL,
    "nextScheduledRunAt" DATETIME,
    "lastScheduledRunAt" DATETIME,
    "lastRunStatus" TEXT,
    "lastRunError" TEXT,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL
);
INSERT INTO "new_Report" ("id", "serverId", "ownerId", "channelId", "title", "description", "queryText", "lookbackDays", "maxRows", "isEnabled", "isSystemManaged", "systemSource", "sourceCompetitionId", "cronExpression", "nextScheduledRunAt", "lastScheduledRunAt", "lastRunStatus", "lastRunError", "createdTime", "updatedTime")
SELECT "id", "serverId", "ownerId", "channelId", "title", "description", "queryText", "lookbackDays", "maxRows", "isEnabled", "isSystemManaged", "systemSource", "sourceCompetitionId", "cronExpression", "nextScheduledRunAt", "lastScheduledRunAt", "lastRunStatus", "lastRunError", "createdTime", "updatedTime"
FROM "Report";
DROP TABLE "Report";
ALTER TABLE "new_Report" RENAME TO "Report";
CREATE INDEX "Report_serverId_isEnabled_idx" ON "Report"("serverId", "isEnabled");
CREATE INDEX "Report_nextScheduledRunAt_idx" ON "Report"("nextScheduledRunAt");
CREATE INDEX "Report_sourceCompetitionId_idx" ON "Report"("sourceCompetitionId");
CREATE INDEX "Report_systemSource_idx" ON "Report"("systemSource");

-- RedefineTable: ReportRun (drop outputFormat)
CREATE TABLE "new_ReportRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportId" INTEGER NOT NULL,
    "serverId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
    "rowsReturned" INTEGER NOT NULL DEFAULT 0,
    "rowsScanned" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "renderedContent" TEXT,
    "imageS3Key" TEXT,
    "imageByteSize" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReportRun" ("id", "reportId", "serverId", "trigger", "status", "startedAt", "completedAt", "durationMs", "rowsReturned", "rowsScanned", "errorMessage", "renderedContent", "imageS3Key", "imageByteSize", "createdAt")
SELECT "id", "reportId", "serverId", "trigger", "status", "startedAt", "completedAt", "durationMs", "rowsReturned", "rowsScanned", "errorMessage", "renderedContent", "imageS3Key", "imageByteSize", "createdAt"
FROM "ReportRun";
DROP TABLE "ReportRun";
ALTER TABLE "new_ReportRun" RENAME TO "ReportRun";
CREATE INDEX "ReportRun_reportId_startedAt_idx" ON "ReportRun"("reportId", "startedAt");
CREATE INDEX "ReportRun_serverId_startedAt_idx" ON "ReportRun"("serverId", "startedAt");
CREATE INDEX "ReportRun_status_startedAt_idx" ON "ReportRun"("status", "startedAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
