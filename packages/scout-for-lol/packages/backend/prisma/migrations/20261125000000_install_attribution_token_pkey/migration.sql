-- Reconcile schema.prisma vs migration history drift so `prisma migrate diff --exit-code` exits 0 (AI-5).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InstallAttributionToken_pkey'
      AND conrelid = '"InstallAttributionToken"'::regclass
  ) THEN
    ALTER TABLE "InstallAttributionToken"
      ADD CONSTRAINT "InstallAttributionToken_pkey" PRIMARY KEY ("id");
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ReportDeliveryChunk_run_fkey'
      AND conrelid = '"ReportDeliveryChunk"'::regclass
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ReportDeliveryChunk_reportRunId_fkey'
      AND conrelid = '"ReportDeliveryChunk"'::regclass
  ) THEN
    ALTER TABLE "ReportDeliveryChunk"
      RENAME CONSTRAINT "ReportDeliveryChunk_run_fkey" TO "ReportDeliveryChunk_reportRunId_fkey";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CustomNightOperation_nightId_fkey'
      AND conrelid = '"CustomNightOperation"'::regclass
      AND confupdtype <> 'c'
  ) THEN
    ALTER TABLE "CustomNightOperation"
      DROP CONSTRAINT "CustomNightOperation_nightId_fkey";
    ALTER TABLE "CustomNightOperation"
      ADD CONSTRAINT "CustomNightOperation_nightId_fkey"
      FOREIGN KEY ("nightId") REFERENCES "CustomNight"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "SupportJob" ALTER COLUMN "updatedAt" DROP DEFAULT;
