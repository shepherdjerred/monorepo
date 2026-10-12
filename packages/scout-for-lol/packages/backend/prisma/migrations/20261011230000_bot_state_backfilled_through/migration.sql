-- BotState.backfilledThroughAt: the end of the last downtime window ingestion
-- reconciliation backfilled to S3. Reconciliation starts its next backfill
-- here rather than at lastSuccessfulPollAt, so a poll that stays stalled while
-- the process is up does not re-scan an ever-growing window on every run.
-- Null until the first backfill completes, which keeps today's behaviour.
ALTER TABLE "BotState" ADD COLUMN "backfilledThroughAt" TIMESTAMP(3);
