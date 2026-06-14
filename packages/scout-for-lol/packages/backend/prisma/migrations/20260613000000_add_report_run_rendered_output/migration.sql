-- Faithful per-run archive of report output. Reports previously persisted only
-- run metadata (status/duration/row counts); the rendered text body and chart
-- PNG were generated in-memory and lost. The web "view posted reports" feature
-- needs the actual output, so each run now stores its rendered text and an S3
-- key for the chart image. All nullable: existing rows, FAILED/RUNNING runs,
-- and text-only output formats have no image.
ALTER TABLE "ReportRun" ADD COLUMN "renderedContent" TEXT;
ALTER TABLE "ReportRun" ADD COLUMN "imageS3Key" TEXT;
ALTER TABLE "ReportRun" ADD COLUMN "imageByteSize" INTEGER;
