-- Move user-configurable report lookback and result limits into ScoutQL before
-- dropping the legacy columns. Query text is rewritten around grammar clause
-- boundaries, not by matching a particular preset string.

UPDATE "Report"
SET "queryText" =
  substr("queryText", 1, instr(lower("queryText"), ' group by ') - 1) ||
  CASE
    WHEN instr(lower("queryText"), ' where ') > 0 THEN ' AND '
    ELSE ' WHERE '
  END ||
  CASE
    WHEN instr(lower("queryText"), ' from prematch_participants ') > 0
      THEN 'observed_at'
    ELSE 'game_creation_at'
  END ||
  ' >= CURRENT_TIMESTAMP - INTERVAL ''' || "lookbackDays" || ' days''' ||
  substr("queryText", instr(lower("queryText"), ' group by '))
WHERE instr(lower("queryText"), ' group by ') > 0
  AND instr(lower("queryText"), ' current_timestamp ') = 0;

UPDATE "Report"
SET "queryText" =
  CASE
    WHEN instr(lower("queryText"), ' render ') > 0 THEN
      substr("queryText", 1, instr(lower("queryText"), ' render ') - 1) ||
      ' LIMIT ' || "maxRows" ||
      substr("queryText", instr(lower("queryText"), ' render '))
    ELSE "queryText" || ' LIMIT ' || "maxRows"
  END
WHERE instr(lower("queryText"), ' limit ') = 0;

-- An explicit query LIMIT may have been looser than the legacy maxRows value.
-- Preserve the stricter of the two bounds during migration.
UPDATE "Report"
SET "queryText" =
  substr("queryText", 1, instr(lower("queryText"), ' limit ') + 6) ||
  "maxRows" ||
  substr(
    "queryText",
    instr(lower("queryText"), ' limit ') + 7 +
      length(CAST(CAST(substr(
        "queryText",
        instr(lower("queryText"), ' limit ') + 7
      ) AS INTEGER) AS TEXT))
  )
WHERE instr(lower("queryText"), ' limit ') > 0
  AND CAST(substr(
    "queryText",
    instr(lower("queryText"), ' limit ') + 7
  ) AS INTEGER) > "maxRows";

-- Abort instead of dropping the only copy of legacy bounds if a stored query
-- could not be converted into the required ScoutQL clauses.
CREATE TABLE "ReportBoundsMigrationGuard" (
  "valid" INTEGER NOT NULL CHECK ("valid" = 1)
);
INSERT INTO "ReportBoundsMigrationGuard" ("valid")
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM "Report"
    WHERE instr(lower("queryText"), ' current_timestamp ') = 0
       OR instr(lower("queryText"), ' limit ') = 0
  ) THEN 0
  ELSE 1
END;
DROP TABLE "ReportBoundsMigrationGuard";

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Report" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "serverId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "queryText" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "isSystemManaged" BOOLEAN NOT NULL DEFAULT false,
  "systemSource" TEXT,
  "sourceCompetitionId" INTEGER,
  "cronExpression" TEXT NOT NULL,
  "scheduleTimezone" TEXT NOT NULL DEFAULT 'UTC',
  "nextScheduledRunAt" DATETIME,
  "lastScheduledRunAt" DATETIME,
  "lastScheduledLocalDate" TEXT,
  "lastRunStatus" TEXT,
  "lastRunError" TEXT,
  "createdTime" DATETIME NOT NULL,
  "updatedTime" DATETIME NOT NULL
);
INSERT INTO "new_Report" (
  "id", "serverId", "ownerId", "channelId", "title", "description",
  "queryText", "isEnabled", "isSystemManaged", "systemSource",
  "sourceCompetitionId", "cronExpression", "scheduleTimezone", "nextScheduledRunAt",
  "lastScheduledRunAt", "lastScheduledLocalDate", "lastRunStatus", "lastRunError", "createdTime",
  "updatedTime"
)
SELECT
  "id", "serverId", "ownerId", "channelId", "title", "description",
  "queryText", "isEnabled", "isSystemManaged", "systemSource",
  "sourceCompetitionId", "cronExpression", 'UTC', "nextScheduledRunAt",
  "lastScheduledRunAt", NULL, "lastRunStatus", "lastRunError", "createdTime",
  "updatedTime"
FROM "Report";
DROP TABLE "Report";
ALTER TABLE "new_Report" RENAME TO "Report";
CREATE INDEX "Report_serverId_isEnabled_idx" ON "Report"("serverId", "isEnabled");
CREATE INDEX "Report_nextScheduledRunAt_idx" ON "Report"("nextScheduledRunAt");
CREATE INDEX "Report_sourceCompetitionId_idx" ON "Report"("sourceCompetitionId");
CREATE INDEX "Report_systemSource_idx" ON "Report"("systemSource");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
