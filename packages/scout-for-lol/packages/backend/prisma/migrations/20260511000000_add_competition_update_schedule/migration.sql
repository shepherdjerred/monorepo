-- Add per-Competition leaderboard-post schedule.
--
-- updateCronExpression: CRON evaluated in UTC; NULL = legacy daily-midnight-UTC default.
-- nextScheduledUpdateAt: monotonic next-fire timestamp the dispatcher matches against now().
-- lastScheduledUpdateAt: wall-clock time of the last dispatched post.
ALTER TABLE "Competition" ADD COLUMN "updateCronExpression" TEXT;
ALTER TABLE "Competition" ADD COLUMN "nextScheduledUpdateAt" DATETIME;
ALTER TABLE "Competition" ADD COLUMN "lastScheduledUpdateAt" DATETIME;

-- Backfill existing active competitions so behavior is identical to the
-- pre-feature midnight-UTC cron: any row that has been started and not ended
-- gets a daily-midnight schedule with its first fire at the next UTC midnight.
UPDATE "Competition"
SET
  "updateCronExpression" = '0 0 * * *',
  "nextScheduledUpdateAt" = datetime((strftime('%s', 'now') / 86400 + 1) * 86400, 'unixepoch')
WHERE "isCancelled" = 0
  AND "startProcessedAt" IS NOT NULL
  AND "endProcessedAt" IS NULL;

CREATE INDEX "Competition_nextScheduledUpdateAt_idx" ON "Competition"("nextScheduledUpdateAt");
