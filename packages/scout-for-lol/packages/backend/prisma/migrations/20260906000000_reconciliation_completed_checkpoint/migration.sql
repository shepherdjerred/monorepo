-- The ingestion-reconciliation completion checkpoint must survive restarts:
-- the gateway-ready boot start races the fixed one-minute schedule right
-- after a rollout, and an in-memory timestamp dies with the old process, so
-- the boot-time duplicate would repeat the Riot scan and S3 backfill.
--
-- Nullable with no default, which is a metadata-only change in PostgreSQL 16;
-- a missing value simply means no completed reconciliation is recorded yet.
ALTER TABLE "BotState"
  ADD COLUMN "reconciliationCompletedAt" TIMESTAMP(3);
