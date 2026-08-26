ALTER TABLE "Report" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "ReportScheduleOutbox" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "ReportScheduleOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportScheduleOutbox_reportId_revision_key" ON "ReportScheduleOutbox"("reportId", "revision");
CREATE INDEX "ReportScheduleOutbox_processedAt_createdAt_idx" ON "ReportScheduleOutbox"("processedAt", "createdAt");

INSERT INTO "ReportScheduleOutbox" ("reportId", "revision", "operation")
SELECT "id", "revision", 'UPSERT' FROM "Report";
