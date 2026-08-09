-- New report runs preserve the exact ScoutQL and versioned visualization model.
-- Existing runs remain nullable and continue to render from their archived PNG.
ALTER TABLE "ReportRun" ADD COLUMN "querySnapshot" TEXT;
ALTER TABLE "ReportRun" ADD COLUMN "visualizationS3Key" TEXT;
ALTER TABLE "ReportRun" ADD COLUMN "visualizationByteSize" INTEGER;

-- Competition analysis uses a persisted IANA timezone. Existing competitions
-- retain their historical UTC interpretation.
ALTER TABLE "Competition" ADD COLUMN "analysisTimezone" TEXT NOT NULL DEFAULT 'UTC';
