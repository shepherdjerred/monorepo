ALTER TABLE "ScoutClientObservation"
  ADD COLUMN "rawEnvelope" JSONB,
  ADD COLUMN "rawArchiveKey" TEXT,
  ADD COLUMN "rawArchiveDigest" TEXT,
  ADD COLUMN "rawArchiveBytes" BIGINT,
  ADD COLUMN "rawArchivedAt" TIMESTAMP(3),
  ADD COLUMN "rawArchiveAttemptAt" TIMESTAMP(3),
  ADD COLUMN "rawArchiveNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "rawArchiveClaimId" TEXT,
  ADD COLUMN "rawArchiveError" TEXT;
CREATE INDEX "ScoutClientObservation_rawArchiveDue_idx"
  ON "ScoutClientObservation"("rawArchivedAt", "rawArchiveNextAttemptAt");
ALTER TABLE "ScoutClientObservation" ADD CONSTRAINT "ScoutClientObservation_raw_archive_check"
  CHECK ("rawArchivedAt" IS NULL OR
    ("rawArchiveKey" IS NOT NULL AND "rawArchiveDigest" IS NOT NULL AND "rawArchiveBytes" IS NOT NULL
      AND "rawArchiveDigest" ~ '^[a-f0-9]{64}$' AND "rawArchiveBytes" >= 0));
