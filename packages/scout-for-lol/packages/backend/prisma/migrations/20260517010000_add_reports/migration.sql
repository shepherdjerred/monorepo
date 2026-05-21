CREATE TABLE "Report" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "queryText" TEXT NOT NULL,
    "lookbackDays" INTEGER NOT NULL DEFAULT 30,
    "maxRows" INTEGER NOT NULL DEFAULT 10,
    "outputFormat" TEXT NOT NULL DEFAULT 'LEADERBOARD',
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

CREATE TABLE "ReportRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportId" INTEGER NOT NULL,
    "serverId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "outputFormat" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
    "rowsReturned" INTEGER NOT NULL DEFAULT 0,
    "rowsScanned" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Report_serverId_isEnabled_idx" ON "Report"("serverId", "isEnabled");
CREATE INDEX "Report_nextScheduledRunAt_idx" ON "Report"("nextScheduledRunAt");
CREATE INDEX "Report_sourceCompetitionId_idx" ON "Report"("sourceCompetitionId");
CREATE INDEX "Report_systemSource_idx" ON "Report"("systemSource");
CREATE INDEX "ReportRun_reportId_startedAt_idx" ON "ReportRun"("reportId", "startedAt");
CREATE INDEX "ReportRun_serverId_startedAt_idx" ON "ReportRun"("serverId", "startedAt");
CREATE INDEX "ReportRun_status_startedAt_idx" ON "ReportRun"("status", "startedAt");
