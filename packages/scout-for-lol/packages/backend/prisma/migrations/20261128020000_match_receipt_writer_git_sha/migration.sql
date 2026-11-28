-- Preserve unknown origin for old rows and old writers. The new-column CHECK
-- applies to writes without scanning the existing table under the DDL lock.
SET LOCAL lock_timeout = '10s';

ALTER TABLE "MatchProcessingReceipt"
  ADD COLUMN "writerGitSha" TEXT,
  ADD CONSTRAINT "MatchProcessingReceipt_writerGitSha_check"
    CHECK ("writerGitSha" IS NULL OR "writerGitSha" ~ '^[a-f0-9]{40}$') NOT VALID;
